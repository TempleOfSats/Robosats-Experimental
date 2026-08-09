package com.robosats.models

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class NotificationPreferencesTest {
    @Test
    fun notificationsAreEnabledWhenNoPreferenceHasBeenSaved() {
        assertTrue(NotificationPreferences.areEnabled(null))
    }

    @Test
    fun notificationsRespectExplicitSavedChoices() {
        assertTrue(NotificationPreferences.areEnabled("true"))
        assertFalse(NotificationPreferences.areEnabled("false"))
        assertFalse(NotificationPreferences.areEnabled("invalid"))
    }

    @Test
    fun freshInstallRequestsPermissionOnlyOnceWhenItIsRequired() {
        val enabledByDefault = NotificationPreferences.areEnabled(null)

        assertEquals(
            NotificationStartupAction.REQUEST_PERMISSION,
            notificationStartupAction(startAttempted = false, enabled = enabledByDefault, permissionGranted = false),
        )
        assertEquals(
            NotificationStartupAction.NONE,
            notificationStartupAction(startAttempted = true, enabled = enabledByDefault, permissionGranted = false),
        )
    }

    @Test
    fun savedOptOutSuppressesStartupAndPermissionPrompt() {
        assertEquals(
            NotificationStartupAction.NONE,
            notificationStartupAction(
                startAttempted = false,
                enabled = NotificationPreferences.areEnabled("false"),
                permissionGranted = false,
            ),
        )
    }

    @Test
    fun grantedPermissionStartsTheServiceAndDenialDisablesNotifications() {
        assertEquals(
            NotificationStartupAction.START_SERVICE,
            notificationStartupAction(startAttempted = false, enabled = true, permissionGranted = true),
        )
        assertEquals(
            NotificationPermissionResultAction.START_SERVICE,
            notificationPermissionResultAction(granted = true, enabled = true),
        )
        assertEquals(
            NotificationPermissionResultAction.DISABLE,
            notificationPermissionResultAction(granted = false, enabled = true),
        )
    }
}
