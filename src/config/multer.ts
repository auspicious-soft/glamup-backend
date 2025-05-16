import multer from "multer"
import fs from 'fs';

export const deleteFile = (filePath: string) => {
    fs.unlink(filePath, (err) => {
        if (err) {
            console.error('Error deleting file:', err);
        }
        else {
            // console.log('File deleted successfully');
        }
    });
};


const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, "src/uploads/");
    },
    filename: (req, file, cb) => {
        // const fileName
        cb(null, Date.now() + "-" + file.originalname);
    }
})

export const upload = multer({
    storage,
    limits: {
        fileSize: 1024 * 1024 * 20, // 10 MB
    },
})
