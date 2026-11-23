package com.tank4444.openpenviewer

import org.cef.browser.CefBrowser
import org.cef.browser.CefFrame
import org.cef.callback.CefCallback
import org.cef.handler.CefRequestHandlerAdapter
import org.cef.handler.CefResourceHandler
import org.cef.handler.CefResourceHandlerAdapter
import org.cef.handler.CefResourceRequestHandler
import org.cef.handler.CefResourceRequestHandlerAdapter
import org.cef.misc.IntRef
import org.cef.misc.StringRef
import org.cef.network.CefRequest
import org.cef.network.CefResponse
import java.io.ByteArrayInputStream
import java.io.InputStream
import java.net.URI

internal const val WEBVIEW_ORIGIN = "http://openpenviewer.local"

internal class PenWebviewRequestHandler : CefRequestHandlerAdapter() {
    private val resourceRequestHandler = object : CefResourceRequestHandlerAdapter() {
        override fun getResourceHandler(
            browser: CefBrowser?,
            frame: CefFrame?,
            request: CefRequest?
        ): CefResourceHandler? {
            val url = request?.url ?: return null
            if (!url.startsWith(WEBVIEW_ORIGIN)) return null
            return ClasspathResourceHandler(url)
        }
    }

    override fun getResourceRequestHandler(
        browser: CefBrowser?,
        frame: CefFrame?,
        request: CefRequest?,
        isNavigation: Boolean,
        isDownload: Boolean,
        requestInitiator: String?,
        disableDefaultHandling: org.cef.misc.BoolRef?
    ): CefResourceRequestHandler? {
        val url = request?.url ?: return null
        return if (url.startsWith(WEBVIEW_ORIGIN)) resourceRequestHandler else null
    }
}

private class ClasspathResourceHandler(private val url: String) : CefResourceHandlerAdapter() {
    private var stream: InputStream? = null
    private var mimeType: String = "application/octet-stream"
    private var statusCode: Int = 200
    private var contentLength: Int = 0

    override fun processRequest(request: CefRequest?, callback: CefCallback?): Boolean {
        val rawPath = try {
            URI(url).path.trimStart('/')
        } catch (_: Exception) {
            ""
        }
        val relPath = if (rawPath.isEmpty()) "index.html" else rawPath
        val resourcePath = "webview/$relPath"
        val bytes = PenWebviewRequestHandler::class.java.classLoader
            .getResourceAsStream(resourcePath)
            ?.use { it.readBytes() }

        if (bytes == null) {
            statusCode = 404
            mimeType = "text/plain"
            val notFound = "Not found: $resourcePath".toByteArray()
            contentLength = notFound.size
            stream = ByteArrayInputStream(notFound)
        } else {
            statusCode = 200
            mimeType = guessMimeType(relPath)
            contentLength = bytes.size
            stream = ByteArrayInputStream(bytes)
        }

        callback?.Continue()
        return true
    }

    override fun getResponseHeaders(
        response: CefResponse?,
        responseLength: IntRef?,
        redirectUrl: StringRef?
    ) {
        response?.mimeType = mimeType
        response?.status = statusCode
        responseLength?.set(contentLength)
    }

    override fun readResponse(
        dataOut: ByteArray?,
        bytesToRead: Int,
        bytesRead: IntRef?,
        callback: CefCallback?
    ): Boolean {
        val input = stream ?: return false
        if (dataOut == null) return false
        val read = input.read(dataOut, 0, minOf(bytesToRead, dataOut.size))
        if (read <= 0) {
            bytesRead?.set(0)
            input.close()
            stream = null
            return false
        }
        bytesRead?.set(read)
        return true
    }

    override fun cancel() {
        stream?.close()
        stream = null
    }

    private fun guessMimeType(path: String): String {
        val ext = path.substringAfterLast('.', "").lowercase()
        return when (ext) {
            "html" -> "text/html; charset=utf-8"
            "js", "mjs" -> "application/javascript; charset=utf-8"
            "css" -> "text/css; charset=utf-8"
            "json", "pen" -> "application/json; charset=utf-8"
            "svg" -> "image/svg+xml"
            "png" -> "image/png"
            "jpg", "jpeg" -> "image/jpeg"
            "woff2" -> "font/woff2"
            "woff" -> "font/woff"
            else -> "application/octet-stream"
        }
    }
}

