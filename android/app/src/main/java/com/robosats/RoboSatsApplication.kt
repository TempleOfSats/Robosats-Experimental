package com.robosats

import android.app.Application
import com.robosats.models.EncryptedStorage

class RoboSatsApplication : Application() {
    override fun onCreate() {
        super.onCreate()
        EncryptedStorage.init(this)
    }
}
