export type MediaType = "image" | "video";

export interface MediaItem {
  type: MediaType;
  url: string;
  thumbnail: string;
  width: number;
  height: number;
  filesize: number;
}

export interface ApiResponse {
  status: "ok" | "error";
  items: MediaItem[];
  error: string | null;
  meta?: {
    type: "post";
    username?: string;
    shortcode?: string;
    postTimestamp?: number;
  };
}
