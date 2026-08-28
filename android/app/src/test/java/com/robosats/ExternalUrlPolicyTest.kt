package com.robosats

import kotlin.test.Test
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class ExternalUrlPolicyTest {
    @Test
    fun allowsOnlySupportedExternalSchemes() {
        listOf("http", "https", "lightning", "bitcoin", "HTTPS").forEach { scheme ->
            assertTrue(isAllowedExternalScheme(scheme), scheme)
        }

        listOf(null, "", "intent", "file", "content", "javascript", "data").forEach { scheme ->
            assertFalse(isAllowedExternalScheme(scheme), scheme ?: "null")
        }
    }
}
