@file:Suppress("DEPRECATION")

package com.robosats.models

import android.content.Context
import android.content.SharedPreferences
import androidx.core.content.edit
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey

object EncryptedStorage {
    private const val PREFERENCES_NAME = "secret_keeper"

    @Volatile
    private var initialized = false
    private lateinit var sharedPreferences: SharedPreferences

    @Synchronized
    fun init(context: Context) {
        if (initialized) return

        val masterKey: MasterKey =
            MasterKey.Builder(context.applicationContext, MasterKey.DEFAULT_MASTER_KEY_ALIAS)
                .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
                .build()

        sharedPreferences = EncryptedSharedPreferences.create(
            context.applicationContext,
            PREFERENCES_NAME,
            masterKey,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
        ) as EncryptedSharedPreferences
        initialized = true
    }

    fun setEncryptedStorage(key: String, value: String) {
        sharedPreferences.edit { putString(key, value) }
    }

    fun getEncryptedStorage(key: String): String {
        return sharedPreferences.getString(key, "") ?: ""
    }

    fun getEncryptedStorageOrNull(key: String): String? {
        return if (sharedPreferences.contains(key)) sharedPreferences.getString(key, null) else null
    }

    fun deleteEncryptedStorage(key: String) {
        sharedPreferences.edit { remove(key) }
    }
}
