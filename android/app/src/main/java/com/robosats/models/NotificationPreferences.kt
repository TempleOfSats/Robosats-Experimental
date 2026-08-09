package com.robosats.models

object NotificationPreferences {
    private const val NOTIFICATIONS_KEY = "settings_notifications"

    fun areEnabled(): Boolean = areEnabled(EncryptedStorage.getEncryptedStorageOrNull(NOTIFICATIONS_KEY))

    fun setEnabled(enabled: Boolean) {
        EncryptedStorage.setEncryptedStorage(NOTIFICATIONS_KEY, enabled.toString())
    }

    internal fun areEnabled(storedValue: String?): Boolean = storedValue == null || storedValue == "true"
}

internal enum class NotificationStartupAction {
    NONE,
    REQUEST_PERMISSION,
    START_SERVICE,
}

internal enum class NotificationPermissionResultAction {
    DISABLE,
    NONE,
    START_SERVICE,
}

internal fun notificationStartupAction(
    startAttempted: Boolean,
    enabled: Boolean,
    permissionGranted: Boolean,
): NotificationStartupAction = when {
    startAttempted || !enabled -> NotificationStartupAction.NONE
    permissionGranted -> NotificationStartupAction.START_SERVICE
    else -> NotificationStartupAction.REQUEST_PERMISSION
}

internal fun notificationPermissionResultAction(
    granted: Boolean,
    enabled: Boolean,
): NotificationPermissionResultAction = when {
    !granted -> NotificationPermissionResultAction.DISABLE
    enabled -> NotificationPermissionResultAction.START_SERVICE
    else -> NotificationPermissionResultAction.NONE
}
