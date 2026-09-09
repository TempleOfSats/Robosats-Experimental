package com.robosats

import kotlin.test.Test
import kotlin.test.assertContentEquals
import kotlin.test.assertFailsWith
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.Protocol
import okhttp3.Request
import okhttp3.Response
import okhttp3.ResponseBody
import okio.Buffer
import java.io.IOException

class BinaryResponseTest {
    @Test
    fun preservesNonUtf8Bytes() {
        val bytes = byteArrayOf(0, -1, -128, 13, 10)
        response(bytes, -1).use {
            assertContentEquals(bytes, java.util.Base64.getDecoder().decode(WebAppInterface.readBinaryBody(it)))
        }
    }

    @Test
    fun rejectsAnOversizedDeclaredBody() {
        response(byteArrayOf(), 10L * 1024 * 1024 + 17).use {
            assertFailsWith<IllegalArgumentException> { WebAppInterface.readBinaryBody(it) }
        }
    }

    @Test
    fun boundsBodiesWithUnknownLength() {
        response(ByteArray(10 * 1024 * 1024 + 17), -1).use {
            assertFailsWith<IOException> { WebAppInterface.readBinaryBody(it) }
        }
    }

    private fun response(bytes: ByteArray, declaredLength: Long): Response {
        val body = object : ResponseBody() {
            private val buffer = Buffer().write(bytes)
            override fun contentType() = "application/octet-stream".toMediaType()
            override fun contentLength() = declaredLength
            override fun source() = buffer
        }
        return Response.Builder()
            .request(Request.Builder().url("https://coordinator.test/blossom/test").build())
            .protocol(Protocol.HTTP_1_1).code(200).message("OK").body(body).build()
    }
}
