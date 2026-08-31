package dev.sirbepy.countoff

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.net.Uri
import android.os.Bundle
import android.webkit.JavascriptInterface
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
import androidx.credentials.CredentialManager
import androidx.credentials.CustomCredential
import androidx.credentials.GetCredentialRequest
import androidx.lifecycle.lifecycleScope
import androidx.webkit.ServiceWorkerControllerCompat
import androidx.webkit.WebViewFeature
import com.google.android.libraries.identity.googleid.GetGoogleIdOption
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential
import kotlinx.coroutines.launch
import org.json.JSONObject

private const val SITE_URL = "https://generic-sirbepy-project.firebaseapp.com/"
private const val SITE_HOST = "generic-sirbepy-project.firebaseapp.com"

// Web OAuth client, not an Android one: Credential Manager requires the web client id
// to mint a verifiable ID token, per Google's Sign-In documentation.
private const val WEB_CLIENT_ID = "639863367604-r7kv9ibju85fao7chbjlpm421aa6iqtb.apps.googleusercontent.com"

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

            override fun onPageStarted(view: WebView, url: String, favicon: Bitmap?) {
                // addJavascriptInterface exposes AndroidAuth to whatever origin is loaded;
                // only the site's own origin may ever see it.
                if (Uri.parse(url).host == SITE_HOST) {
                    view.addJavascriptInterface(AndroidAuthBridge(), "AndroidAuth")
                } else {
                    view.removeJavascriptInterface("AndroidAuth")
                }
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

    // Bridged as window.AndroidAuth; the page holds a Promise that this resolves or
    // rejects by name, since a @JavascriptInterface method cannot return one directly.
    private inner class AndroidAuthBridge {
        @JavascriptInterface
        fun signIn() {
            lifecycleScope.launch {
                try {
                    val idToken = fetchGoogleIdToken()
                    respondToPage("window.__androidAuthResolve(${JSONObject.quote(idToken)})")
                } catch (e: Exception) {
                    val reason = e.message ?: "sign_in_failed"
                    respondToPage("window.__androidAuthReject(${JSONObject.quote(reason)})")
                }
            }
        }
    }

    // Suspends without blocking the caller; Credential Manager shows its own account
    // picker UI and does the network round trip off this thread internally.
    private suspend fun fetchGoogleIdToken(): String {
        val option = GetGoogleIdOption.Builder()
            .setServerClientId(WEB_CLIENT_ID)
            .setFilterByAuthorizedAccounts(false)
            .build()
        val request = GetCredentialRequest.Builder().addCredentialOption(option).build()
        val credential = CredentialManager.create(this).getCredential(this, request).credential
        if (credential !is CustomCredential ||
            credential.type != GoogleIdTokenCredential.TYPE_GOOGLE_ID_TOKEN_CREDENTIAL
        ) {
            throw IllegalStateException("unexpected_credential_type")
        }
        return GoogleIdTokenCredential.createFrom(credential.data).idToken
    }

    private fun respondToPage(script: String) {
        webView.post { webView.evaluateJavascript(script, null) }
    }
}
