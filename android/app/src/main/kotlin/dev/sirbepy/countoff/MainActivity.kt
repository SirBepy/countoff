package dev.sirbepy.countoff

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Bundle
import android.webkit.PermissionRequest
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.ActivityResultLauncher
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat
import androidx.webkit.ServiceWorkerControllerCompat
import androidx.webkit.WebViewFeature

private const val SITE_URL = "https://sirbepy.github.io/countoff/"
private const val SITE_HOST = "sirbepy.github.io"

class MainActivity : ComponentActivity() {

    private lateinit var webView: WebView
    private var filePathCallback: ValueCallback<Array<Uri>>? = null
    private var pendingPermissionRequest: PermissionRequest? = null

    private val fileChooserLauncher: ActivityResultLauncher<Intent> =
        registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
            val data = result.data
            val uris = if (result.resultCode == RESULT_OK && data != null) {
                WebChromeClient.FileChooserParams.parseResult(result.resultCode, data)
            } else {
                null
            }
            filePathCallback?.onReceiveValue(uris)
            filePathCallback = null
        }

    private val permissionLauncher: ActivityResultLauncher<Array<String>> =
        registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) {
            resolvePendingPermissionRequest()
        }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)
        webView = findViewById(R.id.webView)
        configureWebView()
        configureServiceWorker()

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (webView.canGoBack()) {
                    webView.goBack()
                } else {
                    isEnabled = false
                    onBackPressedDispatcher.onBackPressed()
                }
            }
        })

        if (savedInstanceState == null) webView.loadUrl(SITE_URL)
    }

    private fun configureWebView() {
        webView.settings.apply {
            javaScriptEnabled = true
            // Both localStorage and IndexedDB require DOM storage in WebView.
            domStorageEnabled = true
            mediaPlaybackRequiresUserGesture = false
        }

        webView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                if (request.url.host == SITE_HOST) return false
                // External links (lrclib.net etc.) need real browser chrome, or
                // the user is stranded on a page this shell has no way back from.
                startActivity(Intent(Intent.ACTION_VIEW, request.url))
                return true
            }
        }

        webView.webChromeClient = object : WebChromeClient() {
            // A bare WebView ignores <input type="file"> silently; this is the
            // only hook that wires it to a real system file picker.
            override fun onShowFileChooser(
                view: WebView,
                callback: ValueCallback<Array<Uri>>,
                params: FileChooserParams,
            ): Boolean {
                filePathCallback = callback
                fileChooserLauncher.launch(params.createIntent())
                return true
            }

            override fun onPermissionRequest(request: PermissionRequest) {
                val missing = request.resources.filter { resource ->
                    val permission = resource.toRuntimePermission() ?: return@filter false
                    !hasPermission(permission)
                }
                if (missing.isEmpty()) {
                    request.grant(request.resources)
                    return
                }
                pendingPermissionRequest = request
                val runtimePermissions = missing.mapNotNull { it.toRuntimePermission() }.toTypedArray()
                permissionLauncher.launch(runtimePermissions)
            }
        }
    }

    private fun resolvePendingPermissionRequest() {
        val request = pendingPermissionRequest ?: return
        pendingPermissionRequest = null
        val granted = request.resources.filter { resource ->
            val permission = resource.toRuntimePermission() ?: return@filter false
            hasPermission(permission)
        }
        if (granted.isNotEmpty()) request.grant(granted.toTypedArray()) else request.deny()
    }

    private fun String.toRuntimePermission(): String? = when (this) {
        PermissionRequest.RESOURCE_VIDEO_CAPTURE -> Manifest.permission.CAMERA
        else -> null
    }

    private fun hasPermission(permission: String) =
        ContextCompat.checkSelfPermission(this, permission) == PackageManager.PERMISSION_GRANTED

    private fun configureServiceWorker() {
        // ServiceWorkerController is feature-checked, not SDK_INT-gated: some
        // OEM WebView builds lag the platform API level that ships it.
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.SERVICE_WORKER_BASIC_USAGE)) return
        val settings = ServiceWorkerControllerCompat.getInstance().serviceWorkerWebSettings
        if (WebViewFeature.isFeatureSupported(WebViewFeature.SERVICE_WORKER_CONTENT_ACCESS)) {
            settings.allowContentAccess = true
        }
        if (WebViewFeature.isFeatureSupported(WebViewFeature.SERVICE_WORKER_CACHE_MODE)) {
            settings.cacheMode = WebSettings.LOAD_DEFAULT
        }
    }
}
