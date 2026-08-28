package com.robosats

private val allowedExternalSchemes = setOf("http", "https", "lightning", "bitcoin")

internal fun isAllowedExternalScheme(scheme: String?): Boolean =
    scheme?.lowercase() in allowedExternalSchemes
