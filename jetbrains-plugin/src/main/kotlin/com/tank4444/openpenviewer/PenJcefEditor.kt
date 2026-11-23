package com.tank4444.openpenviewer

import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.command.WriteCommandAction
import com.intellij.openapi.editor.Document
import com.intellij.openapi.editor.event.DocumentEvent
import com.intellij.openapi.editor.event.DocumentListener
import com.intellij.openapi.fileEditor.FileDocumentManager
import com.intellij.openapi.fileEditor.FileEditor
import com.intellij.openapi.fileEditor.FileEditorState
import com.intellij.openapi.project.Project
import com.intellij.openapi.util.Disposer
import com.intellij.openapi.util.UserDataHolderBase
import com.intellij.openapi.vfs.VirtualFile
import com.intellij.ui.jcef.JBCefBrowser
import com.intellij.ui.jcef.JBCefBrowserBase
import com.intellij.ui.jcef.JBCefJSQuery
import com.intellij.util.Alarm
import org.cef.browser.CefBrowser
import org.cef.browser.CefFrame
import org.cef.handler.CefLoadHandlerAdapter
import java.beans.PropertyChangeListener
import java.util.Base64
import javax.swing.JComponent

class PenJcefEditor(
    private val project: Project,
    private val file: VirtualFile
) : UserDataHolderBase(), FileEditor {

    private val document: Document? = FileDocumentManager.getInstance().getDocument(file)
    private val browser = JBCefBrowser.createBuilder()
        .setOffScreenRendering(false)
        .build()

    private val saveQuery = JBCefJSQuery.create(browser as JBCefBrowserBase)
    private val updateAlarm = Alarm(Alarm.ThreadToUse.SWING_THREAD, this)

    @Volatile
    private var isUpdatingFromWeb = false

    @Volatile
    private var pageReady = false

    private val docListener = object : DocumentListener {
        override fun documentChanged(event: DocumentEvent) {
            if (isUpdatingFromWeb || !pageReady) return
            updateAlarm.cancelAllRequests()
            updateAlarm.addRequest({
                pushDocumentToWeb()
            }, 250)
        }
    }

    init {
        browser.jbCefClient.addRequestHandler(PenWebviewRequestHandler(), browser.cefBrowser)

        saveQuery.addHandler { newContent ->
            ApplicationManager.getApplication().invokeLater {
                val doc = document ?: return@invokeLater
                WriteCommandAction.runWriteCommandAction(project) {
                    isUpdatingFromWeb = true
                    try {
                        doc.setText(newContent)
                    } finally {
                        isUpdatingFromWeb = false
                    }
                }
            }
            null
        }

        browser.jbCefClient.addLoadHandler(object : CefLoadHandlerAdapter() {
            override fun onLoadStart(
                cefBrowser: CefBrowser?,
                frame: CefFrame?,
                transitionType: org.cef.network.CefRequest.TransitionType?
            ) {
                if (frame?.isMain == true) {
                    injectBridgeAndInitialFile()
                }
            }

            override fun onLoadEnd(cefBrowser: CefBrowser?, frame: CefFrame?, httpStatusCode: Int) {
                if (frame?.isMain != true) return
                pageReady = true
                injectBridgeAndInitialFile()
                pushDocumentToWeb()
            }
        }, browser.cefBrowser)

        document?.addDocumentListener(docListener, this)
        Disposer.register(this, saveQuery)
        Disposer.register(this, browser)

        browser.loadURL("$WEBVIEW_ORIGIN/index.html")
    }

    private fun injectBridgeAndInitialFile() {
        val text = document?.text ?: String(file.contentsToByteArray(), Charsets.UTF_8)
        val b64Content = Base64.getEncoder().encodeToString(text.toByteArray(Charsets.UTF_8))
        val b64Name = Base64.getEncoder().encodeToString(file.name.toByteArray(Charsets.UTF_8))
        val saveCall = saveQuery.inject("content")

        val script = """
            (function() {
              function decodeB64(b64) {
                var bin = atob(b64);
                var bytes = new Uint8Array(bin.length);
                for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
                return new TextDecoder('utf-8').decode(bytes);
              }
              var listeners = [];
              var initial = { name: decodeB64('$b64Name'), content: decodeB64('$b64Content') };
              window.__OPEN_PEN_IDE__ = {
                getInitialFile: function() { return initial; },
                saveContent: function(content) { $saveCall; },
                onContentUpdate: function(cb) {
                  listeners.push(cb);
                  return function() {
                    listeners = listeners.filter(function(l) { return l !== cb; });
                  };
                },
                __notifyUpdate: function(nameB64, contentB64) {
                  var payload = { name: decodeB64(nameB64), content: decodeB64(contentB64) };
                  initial = payload;
                  listeners.forEach(function(cb) { cb(payload); });
                }
              };
              window.dispatchEvent(new Event('openpen-ide-ready'));
            })();
        """.trimIndent()

        browser.cefBrowser.executeJavaScript(script, browser.cefBrowser.url, 0)
    }

    private fun pushDocumentToWeb() {
        val text = document?.text ?: return
        val b64Content = Base64.getEncoder().encodeToString(text.toByteArray(Charsets.UTF_8))
        val b64Name = Base64.getEncoder().encodeToString(file.name.toByteArray(Charsets.UTF_8))
        val script = "window.__OPEN_PEN_IDE__ && window.__OPEN_PEN_IDE__.__notifyUpdate('$b64Name', '$b64Content');"
        browser.cefBrowser.executeJavaScript(script, browser.cefBrowser.url, 0)
    }

    override fun getComponent(): JComponent = browser.component

    override fun getPreferredFocusedComponent(): JComponent = browser.component

    override fun getName(): String = "OpenPenViewer"

    override fun setState(state: FileEditorState) {}

    override fun isModified(): Boolean = false

    override fun isValid(): Boolean = file.isValid

    override fun addPropertyChangeListener(listener: PropertyChangeListener) {}

    override fun removePropertyChangeListener(listener: PropertyChangeListener) {}

    override fun getFile(): VirtualFile = file

    override fun dispose() {}
}
