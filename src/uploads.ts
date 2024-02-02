import multer from "multer";
import fs from "fs";

const b_in_mb = 1048576;

export const multerPath = "uploads";

export const upload = multer({dest: multerPath, limits: {
	files: 20,
	fileSize: 50 * b_in_mb,
} });

export function deleteUpload(path: string) {
	fs.unlinkSync(`${multerPath}/${path}`);
}
