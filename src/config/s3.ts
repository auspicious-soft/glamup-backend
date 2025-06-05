import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { configDotenv } from "dotenv";
import { Readable } from "stream";
configDotenv();

const {
  AWS_ACCESS_KEY_ID,
  AWS_REGION,
  AWS_SECRET_ACCESS_KEY,
  AWS_BUCKET_NAME,
} = process.env;

export const createS3Client = () => {
  return new S3Client({
    region: AWS_REGION,
    credentials: {
      accessKeyId: AWS_ACCESS_KEY_ID as string,
      secretAccessKey: AWS_SECRET_ACCESS_KEY as string,
    },
  });
};

export const generateSignedUrlToUploadOn = async (
  fileName: string,
  fileType: string,
  userEmail: string
) => {
  const uploadParams = {
    Bucket: AWS_BUCKET_NAME,
    Key: `projects/${userEmail}/my-projects/${fileName}`,
    ContentType: fileType,
  };
  try {
    const command = new PutObjectCommand(uploadParams);
    const signedUrl = await getSignedUrl(createS3Client(), command);
    return signedUrl;
  } catch (error) {
    console.error("Error generating signed URL:", error);
    throw error;
  }
};

// New function to upload a stream directly to S3
export const uploadStreamToS3ofClient = async (
  fileStream: Readable,
  fileName: string,
  fileType: string,
  userEmail: string
): Promise<string> => {
  try {
    // Generate a unique key for the file
    const timestamp = Date.now();
    const key = `clients/${userEmail}/profile-pictures/${timestamp}-${fileName}`;

    // Convert stream to buffer for S3 upload
    const chunks: any[] = [];
    for await (const chunk of fileStream) {
      chunks.push(chunk);
    }
    const buffer = Buffer.concat(chunks);

    // Upload to S3
    const s3Client = createS3Client();
    const uploadParams = {
      Bucket: AWS_BUCKET_NAME,
      Key: key,
      Body: buffer,
      ContentType: fileType,
    };

    await s3Client.send(new PutObjectCommand(uploadParams));
    
    // Return just the key, not the full URL
    return key;
  } catch (error) {
    console.error("Error uploading to S3:", error);
    throw error;
  }
};

export const uploadStreamToS3ofTeamMember = async (
  fileStream: Readable,
  fileName: string,
  fileType: string,
  userEmail: string
): Promise<string> => {
  try {
    // Generate a unique key for the file
    const timestamp = Date.now();
    const key = `team-members/${userEmail}/profile-pictures/${timestamp}-${fileName}`;

    // Convert stream to buffer for S3 upload
    const chunks: any[] = [];
    for await (const chunk of fileStream) {
      chunks.push(chunk);
    }
    const buffer = Buffer.concat(chunks);

    // Upload to S3
    const s3Client = createS3Client();
    const uploadParams = {
      Bucket: AWS_BUCKET_NAME,
      Key: key,
      Body: buffer,
      ContentType: fileType,
    };

    await s3Client.send(new PutObjectCommand(uploadParams));

    // Return the S3 object key
    return key;
  } catch (error) {
    console.error("Error uploading to S3:", error);
    throw error;
  }
};

export const uploadStreamToS3ofUser = async (
  fileStream: Readable,
  fileName: string,
  fileType: string,
  userEmail: string
): Promise<string> => {
  try {
    // Generate a unique key for the file
    const timestamp = Date.now();
    const key = `users/${userEmail}/profile-pictures/${timestamp}-${fileName}`;

    // Convert stream to buffer for S3 upload
    const chunks: any[] = [];
    for await (const chunk of fileStream) {
      chunks.push(chunk);
    }
    const buffer = Buffer.concat(chunks);

    // Upload to S3
    const s3Client = createS3Client();
    const uploadParams = {
      Bucket: AWS_BUCKET_NAME,
      Key: key,
      Body: buffer,
      ContentType: fileType,
    };

    await s3Client.send(new PutObjectCommand(uploadParams));

    // Return the S3 object key
    return key;
  } catch (error) {
    console.error("Error uploading to S3:", error);
    throw error;
  }
};
export const deleteFileFromS3 = async (imageKey: string) => {
  const params = {
    Bucket: process.env.AWS_BUCKET_NAME,
    Key: imageKey,
  };
  try {
    const s3Client = await createS3Client();
    const command = new DeleteObjectCommand(params);
    const response = await s3Client.send(command);
    return response;
  } catch (error) {
    console.error("Error deleting file from S3:", error);
    throw error;
  }
};

// Add this function to get the full S3 URL from a key
export const getS3FullUrl = (key: string): string => {
  const bucketName = process.env.AWS_BUCKET_NAME;
  const region = process.env.AWS_REGION || 'eu-north-1';
  return `https://${bucketName}.s3.${region}.amazonaws.com/${key}`;
};
