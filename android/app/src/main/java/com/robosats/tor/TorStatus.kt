package com.robosats.tor

sealed interface TorStatus {
    data object Off : TorStatus
    data class Connecting(val progress: Int = 0) : TorStatus
    data class Active(val port: Int) : TorStatus
    data class Failed(val reason: String) : TorStatus
}
