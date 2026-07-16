package com.robosats.net

import okhttp3.OkHttpClient
import java.net.Proxy
import java.util.concurrent.TimeUnit

object NativeNetworkClient {
    @Volatile
    private var client: OkHttpClient? = null

    @Synchronized
    fun initialize(proxy: Proxy) {
        client?.let { previous ->
            previous.dispatcher.cancelAll()
            previous.connectionPool.evictAll()
            previous.dispatcher.executorService.shutdown()
        }
        client = OkHttpClient.Builder()
            .proxy(proxy)
            .connectTimeout(90, TimeUnit.SECONDS)
            .readTimeout(180, TimeUnit.SECONDS)
            .writeTimeout(180, TimeUnit.SECONDS)
            .callTimeout(240, TimeUnit.SECONDS)
            .pingInterval(25, TimeUnit.SECONDS)
            .retryOnConnectionFailure(true)
            .build()
    }

    fun requireClient(): OkHttpClient = client
        ?: throw IllegalStateException("Tor is not ready")

    @Synchronized
    fun clear() {
        client?.dispatcher?.cancelAll()
        client?.connectionPool?.evictAll()
        client = null
    }
}
