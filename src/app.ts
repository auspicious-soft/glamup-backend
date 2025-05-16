import express from "express"
import cors from "cors"
import path from "path"
import { fileURLToPath } from 'url'
import connectDB from "./config/db"
import bodyParser from 'body-parser'
import cookieParser from 'cookie-parser'

import {admin, auth, user} from "./routes"

const __filename = fileURLToPath(import.meta.url) 
const __dirname = path.dirname(__filename)      

const PORT = process.env.PORT || 8000
const app = express()

app.use(express.json());
app.set("trust proxy", true)
app.use(bodyParser.json({
  verify: (req: any, res, buf) => {
    req.rawBody = buf.toString();
  }
}));
app.use(cookieParser());
app.use(express.urlencoded({ extended: true }));


app.use(
    cors({
        origin: process.env.NODE_ENV === 'production' ? process.env.FRONTEND_URL || 'https://yourdomain.com' : 'http://localhost:3000',
        methods: ['GET', 'POST', 'PATCH', 'DELETE', 'PUT'],
        credentials: true,
    })
);

var dir = path.join(__dirname, 'static')
app.use(express.static(dir))

var uploadsDir = path.join(__dirname, 'uploads')
app.use('/uploads', express.static(uploadsDir))

connectDB();

app.use('/api', auth);
app.use('/api/user', user);
app.use('/api/admin', admin);
app.get("/", (_, res: any) => {
    res.send("Hello world entry point 🚀✅");
});



app.listen(PORT, () => console.log(`Server is listening on port ${PORT}`)); 