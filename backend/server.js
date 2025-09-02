const express = require("express");
const cors = require("cors");
require("dotenv").config({ debug: true });
const pool = require("./db");

const app = express();
app.set("trust proxy", 1);

const raw = process.env.CORS_ORIGINS || "";
const normalize = (s) => s.replace(/\/+$/, "");
const envAllow = raw.split(",").map(s => s.trim()).filter(Boolean).map(normalize);
const defaultAllow = ["http://localhost:3000","http://127.0.0.1:3000","https://capstone-front-tau.vercel.app"];
const allowList = envAllow.length ? envAllow : defaultAllow;
const corsOptions = {
  origin(o, cb){ if(!o) return cb(null,true); try{
      const h = new URL(o).hostname;
      if (allowList.includes(normalize(o)) || h.endsWith(".vercel.app") || h==="localhost"||h==="127.0.0.1") return cb(null,true);
    }catch{} return cb(new Error(`Not allowed by CORS: ${o}`)); },
  credentials:true, optionsSuccessStatus:204,
  methods:["GET","POST","PUT","PATCH","DELETE","OPTIONS"],
  allowedHeaders:["Content-Type","Authorization","X-Requested-With","x-user-id"],
};
app.use(cors(corsOptions));
app.options(/.*/, cors(corsOptions));
app.use(express.json({ limit:"20mb" }));

app.get("/", (_req,res)=>res.send("정상작동"));
app.get("/health", async (_req,res)=>{
  try{ await pool.query("SELECT 1"); res.send("Server & Database connection OK"); }
  catch(e){ console.error(e); res.status(500).send("Database connection failed"); }
});

function safeRequire(p){ try{ const m=require(p); console.log(`[router] ${p}`); return m; }
  catch(e){ console.warn(`[router] skip ${p}`, e.code||e.message); return null; } }

const photoRoutes = safeRequire("./routes/photos");
const recommendationRoutes = safeRequire("./routes/recommendations");
const imageRoutes = safeRequire("./routes/images");
const userRoutes = safeRequire("./routes/users");
const musicRoutes = safeRequire("./routes/musics");
const authRoutes = safeRequire("./routes/auth");
const onboardingRoutes = safeRequire("./routes/onboarding");
const historyRoutes = safeRequire("./routes/history");
const musicRequestRoutes = safeRequire("./routes/musicRequests");

if (photoRoutes) app.use("/api/photos", photoRoutes);
if (recommendationRoutes) app.use("/api/recommendations", recommendationRoutes);
if (imageRoutes) app.use("/api/images", imageRoutes);
if (userRoutes) app.use("/api/users", userRoutes);
if (musicRoutes) app.use("/api/musics", musicRoutes);
if (authRoutes) app.use("/api/auth", authRoutes);
if (onboardingRoutes) app.use("/api", onboardingRoutes);
if (historyRoutes) app.use("/api/history", historyRoutes);
if (musicRequestRoutes) app.use("/api/music-requests", musicRequestRoutes);

app.use((req,res,next)=>{ if(res.headersSent) return next(); res.status(404).json({error:"not found", path:req.originalUrl}); });
app.use((err,_req,res,_next)=>{ console.error("[error]",err); res.status(500).json({error:"internal error"}); });

const PORT = Number(process.env.PORT||5000);
app.listen(PORT, ()=>console.log(`[server] http://localhost:${PORT}`));
