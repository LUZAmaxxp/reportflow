"use client";

import { useState, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Upload, UploadCloud } from "lucide-react";
import { toast } from "sonner";
import { motion } from "framer-motion";
import ErrorAlert from "@/components/ui/ErrorAlert";
import UploadProgressOverlay from "./UploadProgressOverlay";

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB
const MAX_PAGE_COUNT = 200;
const ALLOWED_MIME_TYPES = [
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/tiff",
];

interface UploadButtonProps {
  onUploadComplete?: (result: {
    documentId: string;
    documentVersionId: string;
    pipelineStatus: string;
  }) => void;
}

/**
 * Client upload trigger and orchestration.
 * Validates local file constraints before network: size <= 50MB,
 * mime allowlist, pdf page count <= 200 via pdfjs-dist.
 * Calls /api/uploads/init, executes XHR PUT to R2 with progress events,
 * then calls /api/uploads/complete.
 */
export default function UploadButton({ onUploadComplete }: UploadButtonProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [isRetrying, setIsRetrying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const retryCountRef = useRef(0);

  const resetState = useCallback(() => {
    setIsUploading(false);
    setProgress(0);
    setIsRetrying(false);
    setError(null);
    setSelectedFile(null);
    retryCountRef.current = 0;
  }, []);

  const getPageCount = async (file: File): Promise<number> => {
    if (file.type !== "application/pdf") return 1;

    try {
      const pdfjsLib = await import("pdfjs-dist");
      pdfjsLib.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
      const arrayBuffer = await file.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
      return pdf.numPages;
    } catch {
      return 1;
    }
  };

  const uploadToR2 = (url: string, file: File): Promise<void> => {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("PUT", url, true);
      xhr.setRequestHeader("Content-Type", file.type);

      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
          setProgress((e.loaded / e.total) * 100);
        }
      };

      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve();
        } else if (xhr.status === 403) {
          reject(new Error("PRESIGNED_EXPIRED"));
        } else {
          reject(new Error(`Upload failed with status ${xhr.status}`));
        }
      };

      xhr.onerror = () => reject(new Error("Erreur réseau lors de l'envoi"));
      xhr.send(file);
    });
  };

  const performUpload = async (file: File) => {
    setIsUploading(true);
    setProgress(0);
    setError(null);

    try {
      // Validate file size client-side
      // TODO: verify - Client-side upload >50MB is rejected before /api/uploads/init call with French validation message
      if (file.size > MAX_FILE_SIZE) {
        setError("Le fichier dépasse la limite de 50 Mo");
        setIsUploading(false);
        return;
      }

      if (!ALLOWED_MIME_TYPES.includes(file.type)) {
        setError("Type de fichier non supporté");
        setIsUploading(false);
        return;
      }

      const pageCount = await getPageCount(file);
      if (pageCount > MAX_PAGE_COUNT) {
        setError("Le document dépasse la limite de 200 pages");
        setIsUploading(false);
        return;
      }

      // Step 1: Get presigned URL
      const initRes = await fetch("/api/uploads/init", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filename: file.name,
          fileSize: file.size,
          mimeType: file.type,
          pageCount,
          categoryId: null,
        }),
      });

      if (!initRes.ok) {
        const errData = await initRes.json().catch(() => ({}));
        setError(errData.message ?? "Erreur lors de l'initialisation de l'envoi");
        return;
      }

      const { uploadUrl, objectKey } = await initRes.json();

      // Step 2: Upload to R2
      try {
        await uploadToR2(uploadUrl, file);
      } catch (uploadError: any) {
        if (uploadError.message === "PRESIGNED_EXPIRED" && retryCountRef.current === 0) {
          // Auto-retry exactly once
          retryCountRef.current = 1;
          setIsRetrying(true);
          setProgress(0);

          const retryInitRes = await fetch("/api/uploads/init", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              filename: file.name,
              fileSize: file.size,
              mimeType: file.type,
              pageCount,
              categoryId: null,
            }),
          });

          if (!retryInitRes.ok) {
            setError("Erreur lors de la nouvelle tentative d'envoi");
            return;
          }

          const retryData = await retryInitRes.json();

          try {
            await uploadToR2(retryData.uploadUrl, file);
          } catch (retryErr: any) {
            if (retryErr.message === "PRESIGNED_EXPIRED") {
              setError("Le lien d'envoi a expiré. Veuillez réessayer.");
            } else {
              setError(retryErr.message ?? "Erreur lors de l'envoi");
            }
            return;
          }

          setIsRetrying(false);
          // Continue with complete using new objectKey
          const completeRes = await fetch("/api/uploads/complete", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              objectKey: retryData.objectKey,
              filename: file.name,
              pageCount,
              categoryId: null,
              clientId: null,
            }),
          });

          if (!completeRes.ok) {
            const errData = await completeRes.json().catch(() => ({}));
            setError(errData.message ?? "Erreur lors de la finalisation");
            return;
          }

          const result = await completeRes.json();
          toast.success("Document importé avec succès");
          onUploadComplete?.(result);
          setIsOpen(false);
          resetState();
          return;
        } else if (uploadError.message !== "PRESIGNED_EXPIRED") {
          // Non-403 errors stop immediately without automatic retry
          setError(uploadError.message ?? "Erreur lors de l'envoi");
          return;
        } else {
          // Second 403 after retry
          setError("Le lien d'envoi a expiré. Veuillez réessayer.");
          return;
        }
      }

      // Step 3: Complete upload
      const completeRes = await fetch("/api/uploads/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          objectKey,
          filename: file.name,
          pageCount,
          categoryId: null,
          clientId: null,
        }),
      });

      if (!completeRes.ok) {
        const errData = await completeRes.json().catch(() => ({}));
        setError(errData.message ?? "Erreur lors de la finalisation");
        return;
      }

      const result = await completeRes.json();
      toast.success("Document importé avec succès");
      onUploadComplete?.(result);
      setIsOpen(false);
      resetState();
    } catch (err: any) {
      setError(err.message ?? "Une erreur inattendue s'est produite");
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setSelectedFile(file);
    }
  };

  const handleSubmit = () => {
    if (selectedFile) {
      performUpload(selectedFile);
    }
  };

  const handleManualRetry = () => {
    retryCountRef.current = 0;
    if (selectedFile) {
      performUpload(selectedFile);
    }
  };

  return (
    <>
      <Dialog open={isOpen} onOpenChange={(open) => {
        setIsOpen(open);
        if (!open) resetState();
      }}>
        <DialogTrigger asChild>
          <Button>
            <Upload className="mr-2 size-4" />
            Importer un document
          </Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Importer un document</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {error && !isUploading && (
              <ErrorAlert message={error} onRetry={handleManualRetry} />
            )}
            <div className="space-y-2">
              <Label htmlFor="file-upload">Fichier</Label>
              <motion.div
                whileHover={{ scale: 1.01 }}
                whileTap={{ scale: 0.99 }}
                transition={{ duration: 0.15 }}
              >
                <div
                  onClick={() => fileInputRef.current?.click()}
                  onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                  onDragLeave={() => setIsDragging(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setIsDragging(false);
                    const file = e.dataTransfer.files?.[0];
                    if (file) setSelectedFile(file);
                  }}
                  className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors ${
                    isDragging
                      ? "border-primary bg-primary/5"
                      : "border-border"
                  }`}
                >
                  {selectedFile ? (
                    <>
                      <p className="font-medium text-sm">{selectedFile.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {(selectedFile.size / 1024 / 1024).toFixed(1)} Mo
                      </p>
                    </>
                  ) : (
                    <>
                      <UploadCloud className="size-10 text-muted-foreground mb-2 mx-auto" />
                      <p className="text-sm font-medium">Glissez un fichier ici</p>
                      <p className="text-xs text-muted-foreground">ou cliquez pour sélectionner</p>
                    </>
                  )}
                </div>
              </motion.div>
              <Input
                id="file-upload"
                ref={fileInputRef}
                type="file"
                accept=".pdf,.png,.jpg,.jpeg,.webp,.tiff"
                onChange={handleFileChange}
                disabled={isUploading}
                className="hidden"
              />
              <p className="text-xs text-muted-foreground">
                PDF, PNG, JPEG, WebP ou TIFF — 50 Mo max, 200 pages max
              </p>
            </div>
            <div className="flex justify-end">
              <motion.div whileTap={{ scale: 0.97 }}>
                <Button
                  onClick={handleSubmit}
                  disabled={!selectedFile || isUploading}
                >
                  {isUploading ? "Envoi en cours…" : "Importer"}
                </Button>
              </motion.div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <UploadProgressOverlay
        isVisible={isUploading}
        progress={progress}
        isRetrying={isRetrying}
        error={error}
        onManualRetry={handleManualRetry}
        onDismiss={() => {
          setIsUploading(false);
          setError(null);
        }}
      />
    </>
  );
}
