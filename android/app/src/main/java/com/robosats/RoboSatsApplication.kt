package com.robosats

import android.app.Application
import com.robosats.models.EncryptedStorage
import com.robosats.tor.TorNetworkRecovery
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob

class RoboSatsApplication : Application() {
    private val applicationScope = CoroutineScope(SupervisorJob() + Dispatchers.Default)

    lateinit var networkRecovery: TorNetworkRecovery
        private set

    override fun onCreate() {
        super.onCreate()
        EncryptedStorage.init(this)
        networkRecovery = TorNetworkRecovery(this, applicationScope)
    }
}
