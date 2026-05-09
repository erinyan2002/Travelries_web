// Shared types used across pages

export type MapPhoto = {
  id: string;
  fileName: string;
  imageUrl: string;
  lat?: number;
  lng?: number;
  location?: string;
  captureDate?: string;
  captureTime?: string;
  uploadedAt?: string;
  faceCount?: number;
  image_path?: string; // storage path, used for deletion
};

export type FacePhoto = {
  id: string;
  fileName: string;
  imageUrl: string;
  faceCount: number;
  uploadedAt: string;
  boxes?: Array<{ x: number; y: number; width: number; height: number }>;
  descriptors?: number[][];
  lat?: number;
  lng?: number;
  location?: string;
  image_path?: string; // storage path, used for deletion
};

// Convert a Supabase photos row to MapPhoto
export function rowToMapPhoto(
  row: Record<string, unknown>,
  publicUrl: string
): MapPhoto {
  return {
    id: row.id as string,
    fileName: row.file_name as string,
    imageUrl: publicUrl,
    lat: row.lat as number,
    lng: row.lng as number,
    location: (row.location as string) ?? undefined,
    captureDate: (row.capture_date as string) ?? undefined,
    captureTime: (row.capture_time as string) ?? undefined,
    uploadedAt: row.uploaded_at as string,
    faceCount: (row.face_count as number) ?? 0,
    image_path: row.image_path as string,
  };
}

// Convert a Supabase face_photos row to FacePhoto
export function rowToFacePhoto(
  row: Record<string, unknown>,
  publicUrl: string
): FacePhoto {
  return {
    id: row.id as string,
    fileName: row.file_name as string,
    imageUrl: publicUrl,
    faceCount: (row.face_count as number) ?? 0,
    uploadedAt: row.uploaded_at as string,
    boxes: (row.boxes as FacePhoto["boxes"]) ?? undefined,
    descriptors: (row.descriptors as number[][]) ?? undefined,
    lat: (row.lat as number) ?? undefined,
    lng: (row.lng as number) ?? undefined,
    location: (row.location as string) ?? undefined,
    image_path: row.image_path as string,
  };
}
