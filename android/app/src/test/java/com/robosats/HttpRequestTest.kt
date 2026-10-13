package com.robosats

import java.util.Base64
import kotlin.test.Test
import kotlin.test.assertContentEquals
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNull
import okio.Buffer

class HttpRequestTest {
    private val url = "http://coordinator.test/blossom/upload"
    private val bytes = byteArrayOf(0, -1, -128, 13, 10)

    @Test
    fun preservesBinaryContentTypeForEveryHeaderCasing() {
        for (name in listOf("content-type", "Content-Type", "CONTENT-TYPE")) {
            val request = WebAppInterface.buildHttpRequest("PUT", url, mapOf(
                name to "application/octet-stream", "authorization" to "Nostr synthetic"
            ), Base64.getEncoder().encodeToString(bytes), true)
            assertEquals("application/octet-stream", request.body!!.contentType().toString())
            assertEquals("application/octet-stream", request.header("Content-Type"))
            assertEquals("Nostr synthetic", request.header("Authorization"))
            val buffer = Buffer()
            request.body!!.writeTo(buffer)
            assertContentEquals(bytes, buffer.readByteArray())
            assertEquals(bytes.size.toLong(), request.body!!.contentLength())
        }
    }

    @Test
    fun binaryDefaultsToOctetStreamAndTextKeepsJsonDefault() {
        val binary = WebAppInterface.buildHttpRequest("PUT", url, emptyMap(), "", true)
        assertEquals("application/octet-stream", binary.body!!.contentType().toString())
        val json = WebAppInterface.buildHttpRequest("POST", url, emptyMap(), "{}", false)
        assertEquals("application/json; charset=utf-8", json.body!!.contentType().toString())
    }

    @Test
    fun preservesOtherTextContentTypesAndUtf8() {
        val request = WebAppInterface.buildHttpRequest("POST", url,
            mapOf("content-type" to "text/plain; charset=utf-8"), "synthetic café", false)
        assertEquals("text/plain; charset=utf-8", request.body!!.contentType().toString())
        val buffer = Buffer()
        request.body!!.writeTo(buffer)
        assertEquals("synthetic café", buffer.readUtf8())
    }

    @Test
    fun downloadAndHeadHaveNoRequestBody() {
        for (method in listOf("GET", "HEAD")) {
            val request = WebAppInterface.buildHttpRequest(method, url, emptyMap(), "", true)
            assertEquals(method, request.method)
            assertNull(request.body)
        }
    }

    @Test
    fun preservesSupportedMethodsAndRejectsInvalidOnes() {
        for (method in listOf("POST", "PUT", "PATCH", "DELETE")) {
            val request = WebAppInterface.buildHttpRequest(method.lowercase(), url, emptyMap(), "{}", false)
            assertEquals(method, request.method)
        }
        assertFailsWith<IllegalArgumentException> {
            WebAppInterface.buildHttpRequest("TRACE", url, emptyMap(), "", true)
        }
    }

    @Test
    fun rejectsMalformedAndOversizedBase64() {
        for (body in listOf("%%%", "A".repeat(((10 * 1024 * 1024 + 18) / 3) * 4 + 1))) {
            assertFailsWith<IllegalArgumentException> {
                WebAppInterface.buildHttpRequest("PUT", url, emptyMap(), body, true)
            }
        }
    }

    @Test
    fun doesNotAcceptCallerHostOrContentLength() {
        val request = WebAppInterface.buildHttpRequest("PUT", url,
            mapOf("HOST" to "unexpected.test", "content-length" to "99999"), "", true)
        assertNull(request.header("Host"))
        assertNull(request.header("Content-Length"))
    }
}
