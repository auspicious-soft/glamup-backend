import express from "express"
import cors from "cors"
import path from "path"
import { fileURLToPath } from 'url'
import connectDB from "./config/db"
import bodyParser from 'body-parser'
import cookieParser from 'cookie-parser'

import {admin, auth, client, globCategories, user} from "./routes"
import { authMiddleware } from "middleware/authMiddleware"
import { clientAuthMiddleware } from "middleware/clientAuthMiddleware"

const __filename = fileURLToPath(import.meta.url) 
const __dirname = path.dirname(__filename)      

const PORT = process.env.PORT || 8000
const app = express()

// Modify the Express configuration to skip JSON parsing for GET requests
app.use((req, res, next) => {
  if (req.method === 'GET') {
    next();
  } else {
    express.json({limit: '50mb'})(req, res, next);
  }
});

app.set("trust proxy", true)
app.use((req, res, next) => {
  if (req.method !== 'GET') {
    bodyParser.json({
      verify: (req: any, res, buf) => {
        req.rawBody = buf.toString();
      }
    })(req, res, next);
  } else {
    next();
  }
});
app.use(cookieParser());
app.use(express.urlencoded({ limit: '50mb', extended: true }));


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

// Protected routes - require authentication
app.use('/api/user',authMiddleware, user);
app.use('/api/admin', admin);
app.use('/api/global-categories', globCategories);
app.use("/api/client", clientAuthMiddleware, client);

app.get("/", (_, res: any) => {
    res.send("Hello world entry point 🚀✅");
});

app.listen(PORT, () => console.log(`Server is listening on port ${PORT}`)); 
