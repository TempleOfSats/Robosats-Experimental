package com.robosats.tor

import android.content.Context
import android.os.SystemClock
import android.util.Log
import com.robosats.net.NativeNetworkClient
import com.vitorpamplona.ammolite.service.HttpClientManager
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import java.io.File
import java.net.InetSocketAddress
import java.net.Proxy
import java.net.Socket

object ArtiTorManager {
    private const val defaultPort = 17392
    private const val maxPortAttempts = 10
    private const val networkResetDebounceMs = 5_000L

    private val lifecycleMutex = Mutex()
    private val _status = MutableStateFlow<TorStatus>(TorStatus.Off)
    val status: StateFlow<TorStatus> = _status.asStateFlow()

    private var initialized = false
    private var proxyRunning = false
    private var dataDirectory: File? = null
    private var lastNetworkResetAt = 0L

    suspend fun start(context: Context): TorStatus = lifecycleMutex.withLock {
        if (proxyRunning && _status.value is TorStatus.Active) return _status.value

        _status.value = TorStatus.Connecting()
        withContext(Dispatchers.IO) {
            try {
                registerNativeLogCallback()
                if (!initialized) {
                    val directory = File(context.filesDir, "arti").also { it.mkdirs() }
                    dataDirectory = directory
                    val result = ArtiNative.initialize(directory.absolutePath)
                    if (result != 0) {
                        _status.value = TorStatus.Failed(
                            if (result == -4) "Tor bootstrap timed out" else "Arti initialization failed ($result)"
                        )
                        return@withContext
                    }
                    initialized = true
                }

                var selectedPort: Int? = null
                for (port in defaultPort until defaultPort + maxPortAttempts) {
                    if (ArtiNative.startSocksProxy(port) == 0) {
                        selectedPort = port
                        break
                    }
                }

                if (selectedPort == null) {
                    _status.value = TorStatus.Failed("Could not bind the local Tor proxy")
                    return@withContext
                }

                proxyRunning = true
                configureNetworkClients(selectedPort)
                _status.value = TorStatus.Active(selectedPort)
            } catch (error: Throwable) {
                Log.e("RoboSatsArti", "Unable to start Arti", error)
                _status.value = TorStatus.Failed(error.message ?: "Unable to start Tor")
            }
        }
        _status.value
    }

    suspend fun stop() = lifecycleMutex.withLock {
        withContext(Dispatchers.IO) {
            if (proxyRunning) ArtiNative.stopSocksProxy()
            proxyRunning = false
            NativeNetworkClient.clear()
            _status.value = TorStatus.Off
        }
    }

    suspend fun reset(context: Context, clearState: Boolean = false): TorStatus = lifecycleMutex.withLock {
        resetUnlocked(context, clearState)
    }

    suspend fun resetAfterNetworkChange(context: Context): TorStatus = lifecycleMutex.withLock {
        val now = SystemClock.elapsedRealtime()
        if (now - lastNetworkResetAt < networkResetDebounceMs) return _status.value
        lastNetworkResetAt = now
        resetUnlocked(context, clearState = false)
    }

    data class ResumeHealthResult(
        val status: TorStatus,
        val transportRebuilt: Boolean,
    )

    suspend fun recoverAfterResume(context: Context): ResumeHealthResult = lifecycleMutex.withLock {
        val active = _status.value as? TorStatus.Active
        if (initialized && proxyRunning && active != null) {
            val listenerHealthy = withContext(Dispatchers.IO) { socksListenerHealthy(active.port) }
            if (listenerHealthy) {
                return@withLock ResumeHealthResult(active, transportRebuilt = false)
            }
        }

        Log.w("RoboSatsArti", "Tor transport was stale after resume; rebuilding Arti")
        ResumeHealthResult(
            status = resetUnlocked(context, clearState = false),
            transportRebuilt = true,
        )
    }

    private suspend fun resetUnlocked(context: Context, clearState: Boolean): TorStatus {
        withContext(Dispatchers.IO) {
            if (proxyRunning) ArtiNative.stopSocksProxy()
            ArtiNative.destroy()
            proxyRunning = false
            initialized = false
            NativeNetworkClient.clear()
            if (clearState) (dataDirectory ?: File(context.filesDir, "arti")).deleteRecursively()
            _status.value = TorStatus.Off
        }
        return startUnlocked(context)
    }

    fun activePort(): Int? = (_status.value as? TorStatus.Active)?.port

    fun isInitialized(): Boolean = initialized

    fun isProxyRunning(): Boolean = proxyRunning

    private suspend fun startUnlocked(context: Context): TorStatus {
        _status.value = TorStatus.Connecting()
        return withContext(Dispatchers.IO) {
            try {
                registerNativeLogCallback()
                val directory = File(context.filesDir, "arti").also { it.mkdirs() }
                dataDirectory = directory
                val initResult = ArtiNative.initialize(directory.absolutePath)
                if (initResult != 0) {
                    _status.value = TorStatus.Failed("Arti initialization failed ($initResult)")
                    return@withContext _status.value
                }
                initialized = true

                val port = (defaultPort until defaultPort + maxPortAttempts)
                    .firstOrNull { ArtiNative.startSocksProxy(it) == 0 }
                if (port == null) {
                    _status.value = TorStatus.Failed("Could not bind the local Tor proxy")
                    return@withContext _status.value
                }

                proxyRunning = true
                configureNetworkClients(port)
                _status.value = TorStatus.Active(port)
                _status.value
            } catch (error: Throwable) {
                Log.e("RoboSatsArti", "Unable to reset Arti", error)
                _status.value = TorStatus.Failed(error.message ?: "Unable to reset Tor")
                _status.value
            }
        }
    }

    private fun registerNativeLogCallback() {
        ArtiNative.setLogCallback { line ->
            Log.d("RoboSatsArti", line)
            if (!line.startsWith(BOOTSTRAP_PROGRESS_PREFIX)) return@setLogCallback
            val progress = line.substringAfter(BOOTSTRAP_PROGRESS_PREFIX)
                .substringBefore('|')
                .toIntOrNull()
                ?.coerceIn(0, 100)
                ?: return@setLogCallback
            if (_status.value is TorStatus.Connecting) {
                _status.value = TorStatus.Connecting(progress)
            }
        }
    }

    private fun configureNetworkClients(port: Int) {
        val proxy = Proxy(Proxy.Type.SOCKS, InetSocketAddress("127.0.0.1", port))
        NativeNetworkClient.initialize(proxy)
        HttpClientManager.setDefaultProxy(proxy)
    }

    private fun socksListenerHealthy(port: Int): Boolean = runCatching {
        Socket().use { socket ->
            socket.connect(InetSocketAddress("127.0.0.1", port), SOCKS_HEALTH_TIMEOUT_MS)
        }
        true
    }.getOrDefault(false)

    private const val BOOTSTRAP_PROGRESS_PREFIX = "BOOTSTRAP_PROGRESS|"
    private const val SOCKS_HEALTH_TIMEOUT_MS = 1_500
}
