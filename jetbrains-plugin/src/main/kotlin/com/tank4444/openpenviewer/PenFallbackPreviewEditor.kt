package com.tank4444.openpenviewer

import com.intellij.openapi.fileEditor.FileEditor
import com.intellij.openapi.fileEditor.FileEditorState
import com.intellij.openapi.util.UserDataHolderBase
import com.intellij.openapi.vfs.VirtualFile
import com.intellij.ui.components.JBLabel
import com.intellij.ui.components.JBPanel
import com.intellij.util.ui.JBUI
import java.awt.BorderLayout
import java.awt.Desktop
import java.awt.FlowLayout
import java.beans.PropertyChangeListener
import java.io.File
import javax.swing.Box
import javax.swing.BoxLayout
import javax.swing.JButton
import javax.swing.JComponent
import javax.swing.SwingConstants

class PenFallbackPreviewEditor(
    private val file: VirtualFile,
    private val reason: String? = null
) : UserDataHolderBase(), FileEditor {

    private val panel = JBPanel<JBPanel<*>>(BorderLayout()).apply {
        border = JBUI.Borders.empty(24)

        val content = JBPanel<JBPanel<*>>().apply {
            layout = BoxLayout(this, BoxLayout.Y_AXIS)
        }

        val title = JBLabel("<html><h2>OpenPenViewer Preview Unavailable</h2></html>").apply {
            horizontalAlignment = SwingConstants.LEFT
        }
        val desc = JBLabel(
            "<html><body style='width: 420px;'>" +
                "<p>JCEF (embedded Chromium) is not available in the current Android Studio Boot Runtime.</p>" +
                (if (reason != null) "<p style='color: gray;'>Details: $reason</p>" else "") +
                "<p><b>How to enable built-in preview:</b><br/>" +
                "1. Open <i>Help → Find Action...</i> and run <b>Choose Boot Java Runtime for the IDE</b>.<br/>" +
                "2. Select a JetBrains Runtime build with <b>JCEF</b> support and restart Android Studio.</p>" +
                "</body></html>"
        )

        val actions = JBPanel<JBPanel<*>>(FlowLayout(FlowLayout.LEFT, 0, 12)).apply {
            val openExternalBtn = JButton("Open .pen in Desktop App").apply {
                addActionListener {
                    try {
                        val localFile = File(file.path)
                        if (localFile.exists() && Desktop.isDesktopSupported()) {
                            Desktop.getDesktop().open(localFile)
                        }
                    } catch (_: Exception) {
                    }
                }
            }
            add(openExternalBtn)
        }

        content.add(title)
        content.add(Box.createVerticalStrut(8))
        content.add(desc)
        content.add(actions)

        add(content, BorderLayout.NORTH)
    }

    override fun getComponent(): JComponent = panel

    override fun getPreferredFocusedComponent(): JComponent = panel

    override fun getName(): String = "OpenPenViewer"

    override fun setState(state: FileEditorState) {}

    override fun isModified(): Boolean = false

    override fun isValid(): Boolean = file.isValid

    override fun addPropertyChangeListener(listener: PropertyChangeListener) {}

    override fun removePropertyChangeListener(listener: PropertyChangeListener) {}

    override fun getFile(): VirtualFile = file

    override fun dispose() {}
}
