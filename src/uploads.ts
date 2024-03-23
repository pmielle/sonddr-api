import multer from "multer";
import fs from "fs";

const b_in_mb = 1048576;

export const multerPath = "uploads";

export const upload = multer({
	storage: multer.diskStorage({
		destination: multerPath,
		filename: (req, file, callback) => {
			const extension = getImageExtension(file);
			const uniqueSuffix = generateUniqueName();
			const filename = `${file.fieldname}-${uniqueSuffix}.${extension}`;
			callback(null, filename)
		},
	}),
	limits: { files: 20, fileSize: 50 * b_in_mb },
});

export function deleteUpload(path: string) {
	fs.unlinkSync(`${multerPath}/${path}`);
}

// private
// --------------------------------------------
function generateUniqueName(): string {
	return Date.now() + '-' + Math.round(Math.random() * 1E9);
}

function getImageExtension(file: Express.Multer.File): string {
	const [type, extension] = file.mimetype.split("/");
	if (type !== "image") { throw new Error(`${file.filename} is not an image; its mimetype is ${file.mimetype}`); };
	return extension;
}
