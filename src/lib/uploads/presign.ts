import { PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { r2Client, R2_BUCKET } from "@/lib/r2";
import { uuidv7 } from "uuidv7";

export async function generateUploadUrl(
  companyId: string,
  ext: string,
  contentType: string,
  contentLength: number
): Promise<{ uploadUrl: string; objectKey: string; expiresIn: number }> {
  const objectKey = `${companyId}/${uuidv7()}/original.${ext}`;
  const expiresIn = 900;

  const command = new PutObjectCommand({
    Bucket: R2_BUCKET,
    Key: objectKey,
    ContentType: contentType,
    ContentLength: contentLength,
  });

  const uploadUrl = await getSignedUrl(r2Client, command, { expiresIn });

  return { uploadUrl, objectKey, expiresIn };
}
