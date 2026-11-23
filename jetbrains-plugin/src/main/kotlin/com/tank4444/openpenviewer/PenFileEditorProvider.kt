package com.tank4444.openpenviewer

import com.intellij.openapi.fileEditor.FileEditor
import com.intellij.openapi.fileEditor.FileEditorPolicy
import com.intellij.openapi.fileEditor.FileEditorProvider
import com.intellij.openapi.fileEditor.TextEditor
import com.intellij.openapi.fileEditor.TextEditorWithPreview
import com.intellij.openapi.fileEditor.impl.text.TextEditorProvider
import com.intellij.openapi.project.DumbAware
import com.intellij.openapi.project.Project
import com.intellij.openapi.vfs.VirtualFile
import com.intellij.ui.jcef.JBCefApp

class PenFileEditorProvider : FileEditorProvider, DumbAware {
    override fun accept(project: Project, file: VirtualFile): Boolean {
        return file.extension.equals("pen", ignoreCase = true)
    }

    override fun createEditor(project: Project, file: VirtualFile): FileEditor {
        val textEditor = TextEditorProvider.getInstance().createEditor(project, file) as TextEditor

        if (!JBCefApp.isSupported()) {
            return TextEditorWithPreview(
                textEditor,
                PenFallbackPreviewEditor(file, "JBCefApp.isSupported() returned false"),
                "OpenPenViewer",
                TextEditorWithPreview.Layout.SHOW_EDITOR
            )
        }

        val previewEditor: FileEditor = try {
            PenJcefEditor(project, file)
        } catch (t: Throwable) {
            return TextEditorWithPreview(
                textEditor,
                PenFallbackPreviewEditor(file, t.message),
                "OpenPenViewer",
                TextEditorWithPreview.Layout.SHOW_EDITOR
            )
        }

        return TextEditorWithPreview(
            textEditor,
            previewEditor,
            "OpenPenViewer",
            TextEditorWithPreview.Layout.SHOW_EDITOR_AND_PREVIEW
        )
    }

    override fun getEditorTypeId(): String = "openpenviewer-split-editor"

    override fun getPolicy(): FileEditorPolicy = FileEditorPolicy.HIDE_DEFAULT_EDITOR
}
