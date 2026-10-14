package com.photosync.telegram

import com.photosync.telegram.telegram.ApiResult
import com.photosync.telegram.telegram.ErrorKind
import com.photosync.telegram.telegram.PhotoUploader
import com.photosync.telegram.telegram.SendPolicy
import com.photosync.telegram.telegram.redact
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class PolicyTest {
    private val mb = 1024L * 1024

    @Test fun smallPhoto_isPhoto() = assertEquals(SendPolicy.Mode.PHOTO, SendPolicy.decide(2 * mb, false))
    @Test fun wantDocument_isDocument() = assertEquals(SendPolicy.Mode.DOCUMENT, SendPolicy.decide(2 * mb, true))
    @Test fun over10MB_fallsBackToDocument() = assertEquals(SendPolicy.Mode.DOCUMENT, SendPolicy.decide(12 * mb, false))
    @Test fun over50MB_tooLarge() = assertEquals(SendPolicy.Mode.TOO_LARGE, SendPolicy.decide(51 * mb, true))

    @Test fun redact_removesToken() = assertEquals("url/bot***/x", redact("url/bot123:abc/x", "123:abc"))

    @Test fun backoff_networkRetriesTwiceThenStops() {
        val e = ApiResult.Err(ErrorKind.NETWORK, "x")
        assertEquals(2_000L, PhotoUploader.backoffMillis(e, 1))
        assertEquals(4_000L, PhotoUploader.backoffMillis(e, 2))
        assertNull(PhotoUploader.backoffMillis(e, 3))
    }

    @Test fun backoff_rateLimitHonoursRetryAfter() {
        assertEquals(6_000L, PhotoUploader.backoffMillis(ApiResult.Err(ErrorKind.RATE_LIMIT, "x", 5), 1))
        assertNull(PhotoUploader.backoffMillis(ApiResult.Err(ErrorKind.RATE_LIMIT, "x", 300), 1))
    }

    @Test fun backoff_permanentErrorsDoNotRetry() {
        assertNull(PhotoUploader.backoffMillis(ApiResult.Err(ErrorKind.UNAUTHORIZED, "x"), 1))
        assertNull(PhotoUploader.backoffMillis(ApiResult.Err(ErrorKind.FORBIDDEN, "x"), 1))
    }
}
