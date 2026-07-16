package com.robosats

import android.util.Log

class RoboIdentities {
    companion object {
        private const val TAG = "RoboIdentities"
        private val libraryLoaded = runCatching {
            System.loadLibrary("robohash")
        }.onFailure {
            Log.e(TAG, "Could not load robot avatar library", it)
        }.isSuccess
    }

    fun generateRobohash(seed: String): String {
        if (!libraryLoaded) return ""
        return runCatching { nativeGenerateRobohash(seed).orEmpty() }
            .onFailure { Log.e(TAG, "Could not generate robot avatar", it) }
            .getOrDefault("")
    }

    private external fun nativeGenerateRobohash(seed: String): String?
}
