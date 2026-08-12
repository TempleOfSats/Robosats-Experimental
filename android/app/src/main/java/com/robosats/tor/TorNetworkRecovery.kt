package com.robosats.tor

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import com.robosats.Connectivity
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.launch

internal data class DefaultNetworkFingerprint(
    val handle: Long,
    val cellular: Boolean,
    val wifi: Boolean,
)

internal sealed interface DefaultNetworkTransition {
    data object None : DefaultNetworkTransition
    data class Initial(val epoch: Long) : DefaultNetworkTransition
    data class Lost(val epoch: Long) : DefaultNetworkTransition
    data class Changed(val epoch: Long) : DefaultNetworkTransition
}

internal class DefaultNetworkState {
    private var current: DefaultNetworkFingerprint? = null
    private var initialized = false
    private var epoch = 0L

    fun onCapabilities(
        fingerprint: DefaultNetworkFingerprint,
        validated: Boolean,
    ): DefaultNetworkTransition {
        if (!validated) {
            if (current?.handle != fingerprint.handle) return DefaultNetworkTransition.None
            current = null
            return DefaultNetworkTransition.Lost(++epoch)
        }

        val previous = current
        current = fingerprint
        if (!initialized) {
            initialized = true
            return DefaultNetworkTransition.Initial(epoch)
        }
        if (previous == fingerprint) return DefaultNetworkTransition.None
        return DefaultNetworkTransition.Changed(++epoch)
    }

    fun onLost(networkHandle: Long): DefaultNetworkTransition {
        if (current?.handle != networkHandle) return DefaultNetworkTransition.None
        current = null
        return DefaultNetworkTransition.Lost(++epoch)
    }
}

internal fun completedRecoveryEpoch(
    requestedEpoch: Long,
    validatedEpoch: Long?,
    transportReady: Boolean,
): Long? = when {
    validatedEpoch == null -> null
    validatedEpoch == requestedEpoch -> requestedEpoch
    validatedEpoch > requestedEpoch && transportReady -> validatedEpoch
    else -> null
}

sealed interface TorNetworkRecoveryEvent {
    val epoch: Long

    data class Unavailable(override val epoch: Long) : TorNetworkRecoveryEvent
    data class Reconnecting(override val epoch: Long) : TorNetworkRecoveryEvent
    data class Completed(
        override val epoch: Long,
        val status: TorStatus,
    ) : TorNetworkRecoveryEvent
}

data class TorNetworkRecoveryDiagnostics(
    val epoch: Long,
    val completedEpoch: Long,
    val recoveryCount: Long,
    val handoffPending: Boolean,
)

/** Owns Android's one process-wide default-network callback and Tor handoff queue. */
class TorNetworkRecovery(
    context: Context,
    scope: CoroutineScope,
) {
    private val applicationContext = context.applicationContext
    private val connectivityManager =
        applicationContext.getSystemService(ConnectivityManager::class.java)
    private val networkState = DefaultNetworkState()
    private val stateLock = Any()
    private val recoveryRequests = Channel<Long>(Channel.CONFLATED)
    private val mutableEvents = MutableSharedFlow<TorNetworkRecoveryEvent>(extraBufferCapacity = 8)

    val events: SharedFlow<TorNetworkRecoveryEvent> = mutableEvents.asSharedFlow()

    @Volatile
    var handoffPending = false
        private set

    @Volatile
    private var currentEpoch = 0L

    @Volatile
    private var validatedRecoveryEpoch: Long? = null

    @Volatile
    private var completedEpoch = 0L

    @Volatile
    private var recoveryCount = 0L

    private val networkCallback = object : ConnectivityManager.NetworkCallback() {
        override fun onCapabilitiesChanged(network: Network, capabilities: NetworkCapabilities) {
            val validated = capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED)
            if (validated) Connectivity.updateNetworkCapabilities(capabilities) else Connectivity.markUnavailable()
            handleTransition(
                networkState.onCapabilities(
                    DefaultNetworkFingerprint(
                        handle = network.networkHandle,
                        cellular = capabilities.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR),
                        wifi = capabilities.hasTransport(NetworkCapabilities.TRANSPORT_WIFI),
                    ),
                    validated,
                ),
            )
        }

        override fun onLost(network: Network) {
            handleTransition(networkState.onLost(network.networkHandle))
        }
    }

    init {
        scope.launch {
            for (epoch in recoveryRequests) {
                val shouldRecover = synchronized(stateLock) {
                    if (validatedRecoveryEpoch != epoch || epoch <= completedEpoch) {
                        false
                    } else {
                        recoveryCount += 1
                        true
                    }
                }
                if (!shouldRecover) continue

                val status = ArtiTorManager.resetAfterNetworkChange(applicationContext, epoch)
                synchronized(stateLock) {
                    val completionEpoch = completedRecoveryEpoch(
                        requestedEpoch = epoch,
                        validatedEpoch = validatedRecoveryEpoch,
                        transportReady = status is TorStatus.Active,
                    ) ?: return@synchronized

                    /*
                     * Arti reports Active only after bootstrap. If a newer default network was
                     * validated while that bootstrap was running, the completed bootstrap is
                     * already a valid recovery boundary for the newer route. Completing the
                     * latest epoch avoids immediately destroying the healthy client again.
                     */
                    completedEpoch = completionEpoch
                    handoffPending = false
                    mutableEvents.tryEmit(TorNetworkRecoveryEvent.Completed(completionEpoch, status))
                }
            }
        }
        connectivityManager.registerDefaultNetworkCallback(networkCallback)
    }

    fun diagnostics(): TorNetworkRecoveryDiagnostics = synchronized(stateLock) {
        TorNetworkRecoveryDiagnostics(
            epoch = currentEpoch,
            completedEpoch = completedEpoch,
            recoveryCount = recoveryCount,
            handoffPending = handoffPending,
        )
    }

    private fun handleTransition(transition: DefaultNetworkTransition) {
        synchronized(stateLock) {
            when (transition) {
                DefaultNetworkTransition.None -> Unit
                is DefaultNetworkTransition.Initial -> {
                    currentEpoch = transition.epoch
                    validatedRecoveryEpoch = null
                    handoffPending = false
                }
                is DefaultNetworkTransition.Lost -> {
                    Connectivity.markUnavailable()
                    currentEpoch = transition.epoch
                    validatedRecoveryEpoch = null
                    handoffPending = true
                    mutableEvents.tryEmit(TorNetworkRecoveryEvent.Unavailable(transition.epoch))
                }
                is DefaultNetworkTransition.Changed -> {
                    currentEpoch = transition.epoch
                    validatedRecoveryEpoch = transition.epoch
                    handoffPending = true
                    mutableEvents.tryEmit(TorNetworkRecoveryEvent.Reconnecting(transition.epoch))
                    recoveryRequests.trySend(transition.epoch)
                }
            }
        }
    }
}
