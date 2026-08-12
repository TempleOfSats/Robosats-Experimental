package com.robosats

import android.net.NetworkCapabilities
import com.vitorpamplona.ammolite.service.HttpClientManager

class Connectivity {
    companion object {
        @Volatile
        var isOnMobileData: Boolean = false
        @Volatile
        var isOnWifiData: Boolean = false
        @Volatile
        var isValidated: Boolean = false

        fun markUnavailable() {
            isValidated = false
        }

        @Synchronized
        fun updateNetworkCapabilities(networkCapabilities: NetworkCapabilities): Boolean {
            val isOnMobileDataNet = networkCapabilities.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR)
            val isOnWifiNet = networkCapabilities.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)
            val isValidatedNet = networkCapabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED)
            isValidated = isValidatedNet
            if (!isValidatedNet) return false

            var changedNetwork = false

            if (isOnMobileData != isOnMobileDataNet) {
                isOnMobileData = isOnMobileDataNet
                changedNetwork = true
            }

            if (isOnWifiData != isOnWifiNet) {
                isOnWifiData = isOnWifiNet
                changedNetwork = true
            }

            if (changedNetwork) {
                if (isOnMobileDataNet) {
                    HttpClientManager.setDefaultTimeout(HttpClientManager.DEFAULT_TIMEOUT_ON_MOBILE)
                } else {
                    HttpClientManager.setDefaultTimeout(HttpClientManager.DEFAULT_TIMEOUT_ON_WIFI)
                }
            }

            return changedNetwork
        }
    }
}
