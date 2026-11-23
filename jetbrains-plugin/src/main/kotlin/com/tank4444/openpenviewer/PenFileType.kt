package com.tank4444.openpenviewer

import com.intellij.icons.AllIcons
import com.intellij.openapi.fileTypes.ex.FileTypeIdentifiableByVirtualFile
import com.intellij.openapi.fileTypes.FileType
import com.intellij.openapi.vfs.VirtualFile
import javax.swing.Icon

class PenFileType private constructor() : FileType, FileTypeIdentifiableByVirtualFile {
    override fun getName(): String = "Pencil Design"

    override fun getDescription(): String = "Pencil.dev .pen design file"

    override fun getDefaultExtension(): String = "pen"

    override fun getIcon(): Icon = AllIcons.FileTypes.Json

    override fun isBinary(): Boolean = false

    override fun isReadOnly(): Boolean = false

    override fun isMyFileType(file: VirtualFile): Boolean {
        return file.extension.equals("pen", ignoreCase = true)
    }

    companion object {
        @JvmField
        val INSTANCE = PenFileType()
    }
}

