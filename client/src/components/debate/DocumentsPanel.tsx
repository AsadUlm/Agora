import DeleteIcon from "@mui/icons-material/Delete";
import FileUploadIcon from "@mui/icons-material/FileUpload";
import InsertDriveFileIcon from "@mui/icons-material/InsertDriveFile";
import {
    Alert,
    Box,
    Button,
    CircularProgress,
    IconButton,
    Skeleton,
    Stack,
    Tooltip,
    Typography,
} from "@mui/material";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import {
    deleteDocument,
    listDocuments,
    uploadDocument,
} from "../../services/documentsService";
import type { DocumentDTO } from "../../types/debate";

const ACCEPTED_TYPES = ".txt,.pdf,.docx";
const MAX_FILE_MB = 20;

function formatDate(iso: string) {
    return new Date(iso).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" });
}

interface DocumentRowProps {
    doc: DocumentDTO;
    onDelete: (id: string) => void;
    deleting: boolean;
}

function DocumentRow({ doc, onDelete, deleting }: DocumentRowProps) {
    const [confirming, setConfirming] = useState(false);

    return (
        <Stack
            direction="row"
            alignItems="center"
            spacing={1.5}
            sx={{
                px: 2,
                py: 1.25,
                bgcolor: "#151821",
                border: "1px solid #2A2D3A",
                borderRadius: 1.5,
            }}
        >
            <InsertDriveFileIcon sx={{ color: "primary.main", fontSize: 20, flexShrink: 0 }} />
            <Box sx={{ flexGrow: 1, minWidth: 0 }}>
                <Typography variant="body2" sx={{ fontWeight: 600 }} noWrap>
                    {doc.filename}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                    {formatDate(doc.created_at)} · {doc.status}
                </Typography>
            </Box>
            {confirming ? (
                <Stack direction="row" spacing={1}>
                    <Button
                        size="small"
                        variant="contained"
                        color="error"
                        disabled={deleting}
                        onClick={() => onDelete(doc.id)}
                        sx={{ minWidth: 60, height: 28, fontSize: "0.72rem" }}
                    >
                        {deleting ? <CircularProgress size={12} color="inherit" /> : "Delete"}
                    </Button>
                    <Button
                        size="small"
                        onClick={() => setConfirming(false)}
                        sx={{ minWidth: 60, height: 28, fontSize: "0.72rem" }}
                    >
                        Cancel
                    </Button>
                </Stack>
            ) : (
                <Tooltip title="Delete document">
                    <IconButton
                        size="small"
                        onClick={() => setConfirming(true)}
                        sx={{ color: "text.secondary", "&:hover": { color: "error.main" } }}
                    >
                        <DeleteIcon fontSize="small" />
                    </IconButton>
                </Tooltip>
            )}
        </Stack>
    );
}

interface DocumentsPanelProps {
    sessionId: string;
}

export default function DocumentsPanel({ sessionId }: DocumentsPanelProps) {
    const queryClient = useQueryClient();
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [uploading, setUploading] = useState(false);
    const [uploadError, setUploadError] = useState<string | null>(null);
    const [deletingId, setDeletingId] = useState<string | null>(null);
    const [dragOver, setDragOver] = useState(false);

    const { data: docs, isLoading, isError } = useQuery({
        queryKey: ["documents", sessionId],
        queryFn: () => listDocuments(sessionId),
        enabled: !!sessionId,
    });

    async function handleFiles(files: FileList | null) {
        if (!files || files.length === 0) return;
        const file = files[0]!;

        if (file.size > MAX_FILE_MB * 1024 * 1024) {
            setUploadError(`File must be under ${MAX_FILE_MB} MB`);
            return;
        }

        const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
        if (!["txt", "pdf", "docx"].includes(ext)) {
            setUploadError("Only .txt, .pdf, and .docx files are supported");
            return;
        }

        setUploadError(null);
        setUploading(true);
        try {
            await uploadDocument(sessionId, file);
            await queryClient.invalidateQueries({ queryKey: ["documents", sessionId] });
        } catch (err: unknown) {
            setUploadError(err instanceof Error ? err.message : "Upload failed");
        } finally {
            setUploading(false);
            if (fileInputRef.current) fileInputRef.current.value = "";
        }
    }

    async function handleDelete(docId: string) {
        setDeletingId(docId);
        try {
            await deleteDocument(docId, sessionId);
            await queryClient.invalidateQueries({ queryKey: ["documents", sessionId] });
        } catch {
            // silently ignore, re-render will show doc still there
        } finally {
            setDeletingId(null);
        }
    }

    return (
        <Box>
            <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 2 }}>
                <Box>
                    <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
                        Session Documents
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                        Upload documents for RAG-grounded responses
                    </Typography>
                </Box>
                <Button
                    variant="outlined"
                    startIcon={uploading ? <CircularProgress size={14} color="inherit" /> : <FileUploadIcon />}
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploading}
                    size="small"
                >
                    {uploading ? "Uploading…" : "Upload"}
                </Button>
                <input
                    ref={fileInputRef}
                    type="file"
                    accept={ACCEPTED_TYPES}
                    style={{ display: "none" }}
                    onChange={(e) => void handleFiles(e.target.files)}
                />
            </Stack>

            {/* Drag-and-drop zone */}
            <Box
                onDragEnter={() => setDragOver(true)}
                onDragLeave={() => setDragOver(false)}
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                onDrop={(e) => {
                    e.preventDefault();
                    setDragOver(false);
                    void handleFiles(e.dataTransfer.files);
                }}
                onClick={() => fileInputRef.current?.click()}
                sx={{
                    border: `2px dashed ${dragOver ? "#F5A623" : "#2A2D3A"}`,
                    borderRadius: 2,
                    p: 3,
                    textAlign: "center",
                    cursor: "pointer",
                    mb: 2,
                    bgcolor: dragOver ? "rgba(245,166,35,0.05)" : "transparent",
                    transition: "border-color 0.2s, background 0.2s",
                    "&:hover": { borderColor: "primary.main", bgcolor: "rgba(245,166,35,0.03)" },
                }}
            >
                <FileUploadIcon sx={{ fontSize: 32, color: "text.secondary", mb: 1, opacity: 0.5 }} />
                <Typography variant="body2" color="text.secondary">
                    Drag & drop or click to upload
                </Typography>
                <Typography variant="caption" color="text.secondary">
                    .txt, .pdf, .docx · max {MAX_FILE_MB} MB
                </Typography>
            </Box>

            {uploadError && (
                <Alert severity="error" sx={{ mb: 2 }} onClose={() => setUploadError(null)}>
                    {uploadError}
                </Alert>
            )}

            {/* Document list */}
            {isLoading && (
                <Stack spacing={1}>
                    {[1, 2].map((i) => (
                        <Skeleton key={i} variant="rounded" height={56} />
                    ))}
                </Stack>
            )}

            {isError && (
                <Alert severity="error">Failed to load documents</Alert>
            )}

            {!isLoading && !isError && (!docs || docs.length === 0) && (
                <Box sx={{ textAlign: "center", py: 4 }}>
                    <InsertDriveFileIcon sx={{ fontSize: 36, opacity: 0.2, mb: 1 }} />
                    <Typography variant="body2" color="text.secondary">
                        No documents uploaded yet
                    </Typography>
                </Box>
            )}

            {docs && docs.length > 0 && (
                <Stack spacing={1}>
                    {docs.map((doc) => (
                        <DocumentRow
                            key={doc.id}
                            doc={doc}
                            onDelete={(id) => void handleDelete(id)}
                            deleting={deletingId === doc.id}
                        />
                    ))}
                </Stack>
            )}
        </Box>
    );
}
