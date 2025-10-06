import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

export const s3Client = new S3Client({ region: process.env.AWS_REGION });



/**
 * Upload a file to S3
 * @param {Object} options
 * @param {string} options.filename - The name/key for the file in S3
 * @param {Buffer} options.buffer - The file buffer (e.g., from multer)
 * @param {string} options.mimeType - MIME type of the file
 * @returns {Promise<Object>} The S3 response
 */
export async function s3Upload({ filename, buffer, mimeType }) {
    const params = {
        Bucket: process.env.AWS_S3_BUCKET,
        Key: filename,
        Body: buffer,
        ContentType: mimeType
    }
    const command = new PutObjectCommand(params)
    return await s3Client.send(command)
}