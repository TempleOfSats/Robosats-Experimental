package com.robosats.tor

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

class DefaultNetworkStateTest {
    private val wifi = DefaultNetworkFingerprint(handle = 10L, cellular = false, wifi = true)
    private val cellular = DefaultNetworkFingerprint(handle = 20L, cellular = true, wifi = false)

    @Test
    fun initialValidatedNetworkDoesNotRebuildTor() {
        val state = DefaultNetworkState()

        assertEquals(
            DefaultNetworkTransition.Initial(epoch = 0L),
            state.onCapabilities(wifi, validated = true),
        )
        assertEquals(
            DefaultNetworkTransition.None,
            state.onCapabilities(wifi, validated = true),
        )
    }

    @Test
    fun repeatedCallbacksForOneReplacementProduceOneEpoch() {
        val state = DefaultNetworkState()
        state.onCapabilities(wifi, validated = true)

        assertEquals(
            DefaultNetworkTransition.Changed(epoch = 1L),
            state.onCapabilities(cellular, validated = true),
        )
        assertEquals(
            DefaultNetworkTransition.None,
            state.onCapabilities(cellular, validated = true),
        )
        assertEquals(
            DefaultNetworkTransition.None,
            state.onLost(wifi.handle),
        )
    }

    @Test
    fun offlineNetworkWaitsForValidationBeforeRecovery() {
        val state = DefaultNetworkState()
        state.onCapabilities(wifi, validated = true)

        assertEquals(DefaultNetworkTransition.Lost(epoch = 1L), state.onLost(wifi.handle))
        assertEquals(
            DefaultNetworkTransition.None,
            state.onCapabilities(cellular, validated = false),
        )
        assertEquals(
            DefaultNetworkTransition.Changed(epoch = 2L),
            state.onCapabilities(cellular, validated = true),
        )
    }

    @Test
    fun losingValidationAndRegainingItCreatesOneFreshRecovery() {
        val state = DefaultNetworkState()
        state.onCapabilities(wifi, validated = true)

        assertEquals(
            DefaultNetworkTransition.Lost(epoch = 1L),
            state.onCapabilities(wifi, validated = false),
        )
        assertEquals(
            DefaultNetworkTransition.None,
            state.onCapabilities(wifi, validated = false),
        )
        assertEquals(
            DefaultNetworkTransition.Changed(epoch = 2L),
            state.onCapabilities(wifi, validated = true),
        )
    }

    @Test
    fun transportChangeOnTheSameDefaultNetworkStillRecovers() {
        val state = DefaultNetworkState()
        state.onCapabilities(wifi, validated = true)
        val cellularTunnel = wifi.copy(cellular = true, wifi = false)

        assertEquals(
            DefaultNetworkTransition.Changed(epoch = 1L),
            state.onCapabilities(cellularTunnel, validated = true),
        )
    }

    @Test
    fun activeInFlightRecoveryCompletesNewestValidatedEpoch() {
        assertEquals(
            4L,
            completedRecoveryEpoch(
                requestedEpoch = 2L,
                validatedEpoch = 4L,
                transportReady = true,
            ),
        )
    }

    @Test
    fun failedInFlightRecoveryLeavesNewestEpochQueued() {
        assertNull(
            completedRecoveryEpoch(
                requestedEpoch = 2L,
                validatedEpoch = 4L,
                transportReady = false,
            ),
        )
    }

    @Test
    fun currentFailedRecoveryCanPublishItsFailure() {
        assertEquals(
            2L,
            completedRecoveryEpoch(
                requestedEpoch = 2L,
                validatedEpoch = 2L,
                transportReady = false,
            ),
        )
    }
}
