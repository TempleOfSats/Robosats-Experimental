package com.robosats.tor

object ArtiNative {
    init {
        System.loadLibrary("arti_android")
    }

    external fun getVersion(): String
    external fun setLogCallback(callback: ArtiLogCallback)
    external fun initialize(dataDir: String): Int
    external fun startSocksProxy(port: Int): Int
    external fun stopSocksProxy(): Int
    external fun destroy(): Int
}

fun interface ArtiLogCallback {
    fun onLogLine(line: String)
}
