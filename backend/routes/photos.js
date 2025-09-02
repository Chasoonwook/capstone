const express=require("express");
const pool=require("../db");
const multer=require("multer");
const crypto=require("crypto");
const jwt=require("jsonwebtoken");
const axios=require("axios");
const router=express.Router();

const USE_ASYNC=process.env.ASYNC_MODE==="1";
const AI_TIMEOUT=Number(process.env.AI_FETCH_TIMEOUT||60000);
const IMG_TOKEN_TTL=String(process.env.IMG_TOKEN_TTL||"180s");
const upload=multer({storage:multer.memoryStorage(),limits:{fileSize:20*1024*1024}});
const base=(req)=>process.env.PUBLIC_API_BASE||`${req.protocol}://${req.get("host")}/api`;

async function resolveMood(c,t,b,e,p){
  if(p?.main_mood) return {main_mood:p.main_mood, sub_mood:p.sub_mood||p.mood_sub||null};
  const q1=await c.query(
    `SELECT main_mood,sub_mood FROM mood_mapping WHERE time_label=$1 AND background=$2 AND emotion=$3 LIMIT 1`,
    [t,b,e]); if(q1.rows[0]) return q1.rows[0];
  const q2=await c.query(`SELECT main_mood,sub_mood FROM mood_mapping WHERE time_label=$1 LIMIT 1`,[t]);
  return q2.rows[0]||{main_mood:null,sub_mood:null};
}
async function recs(c,m,s){
  const a=(await c.query(`SELECT music_id,title,artist,label,genre FROM music WHERE label=$1 ORDER BY created_at DESC LIMIT 7`,[m])).rows;
  const b=(await c.query(`SELECT music_id,title,artist,label,genre FROM music WHERE label=$1 AND music_id NOT IN (SELECT music_id FROM music WHERE label=$2 ORDER BY created_at DESC LIMIT 7) ORDER BY created_at DESC LIMIT 3`,[s,m])).rows;
  return [...a,...b];
}

/* debug who */
router.get("/_who",(_req,res)=>res.json({from:"routes/photos.js", analyzePath:"/api/photos/analyze"}));

/* public binary */
router.get("/:photoId/binary", async (req,res)=>{
  try{
    const {photoId}=req.params;
    const r=await pool.query("SELECT mime_type,content FROM photos WHERE photo_id=$1",[photoId]);
    if(!r.rows.length) return res.status(404).send("Not found");
    res.set("Content-Type", r.rows[0].mime_type||"application/octet-stream");
    res.send(r.rows[0].content);
  }catch(e){ res.status(500).send("Error"); }
});

/* signed url (debug) */
router.get("/:photoId/signed-url",(req,res)=>{
  try{
    const {photoId}=req.params;
    const token=jwt.sign({id:String(photoId)}, process.env.IMG_TOKEN_SECRET, {expiresIn:IMG_TOKEN_TTL});
    res.json({ imageUrl:`${base(req)}/images/${photoId}?token=${token}`, expiresIn:IMG_TOKEN_TTL });
  }catch(e){ res.status(500).json({error:"signed-url failed", detail:e.message}); }
});

/* upload → analyze */
router.post("/analyze", upload.single("file"), async (req,res)=>{
  const client=await pool.connect();
  try{
    if(!req.file) return res.status(400).json({error:"no file"});
    const userId=req.body.userId||"00000000-0000-0000-0000-000000000000";
    const {buffer,originalname,mimetype}=req.file;

    await client.query("BEGIN");
    const temp=crypto.createHash("sha256").update(buffer).digest("hex").slice(0,8);
    const ins=await client.query(
      `INSERT INTO photos (temp_name,original_name,mime_type,content,created_at)
       VALUES ($1,$2,$3,$4,now()) RETURNING photo_id`,
      [temp,originalname,mimetype,buffer]
    );
    const photoId=ins.rows[0].photo_id;

    const token=jwt.sign({id:String(photoId)}, process.env.IMG_TOKEN_SECRET, {expiresIn:IMG_TOKEN_TTL});
    const imageUrl=`${base(req)}/images/${photoId}?token=${token}`;

    const {data:ai}=await axios.post(`${process.env.AI_BASE_URL}/predict`,
      {image_url:imageUrl, photo_id:photoId, user_id:userId},{timeout:AI_TIMEOUT});

    const time=ai.time_label||ai.time||null;
    const back=ai.background||ai.scene||ai.category||null;
    const emo =ai.emotion||ai.final_emotion||ai.rule_emotion||null;

    const {main_mood,sub_mood}=await resolveMood(client,time,back,emo,{main_mood:ai.mood||ai.mood_main, sub_mood:ai.mood_sub});

    await client.query("DELETE FROM photo_analysis WHERE photo_id=$1",[photoId]);
    await client.query(
      `INSERT INTO photo_analysis (photo_id,time_label,background,emotion,main_mood,sub_mood,analyzed_at)
       VALUES ($1,$2,$3,$4,$5,$6,now())`,
      [photoId,time,back,emo,main_mood,sub_mood]
    );

    const items=await recs(client,main_mood,sub_mood);
    await client.query("COMMIT");
    res.json({photoId, analysis:{time_label:time,background:back,emotion:emo,main_mood,sub_mood}, recommendations:items});
  }catch(err){
    await client.query("ROLLBACK");
    const raw=(err&&err.response&&err.response.data)||err?.message||err?.toString()||"unknown error";
    const detail=typeof raw==="string"?raw:JSON.stringify(raw);
    console.error("[analyze FAILED]",{detail, ai_url:`${process.env.AI_BASE_URL}/predict`});
    res.status(500).json({error:"analyze failed", detail, from:"routes/photos.js#analyze"});
  }finally{ client.release(); }
});

/* analyze by id */
router.post("/:photoId/analyze", async (req,res)=>{
  const client=await pool.connect();
  try{
    const {photoId}=req.params;
    const userId=req.body.userId||"00000000-0000-0000-0000-000000000000";
    const ex=await client.query("SELECT 1 FROM photos WHERE photo_id=$1",[photoId]);
    if(!ex.rows.length) return res.status(404).json({error:"photo not found"});

    await client.query("BEGIN");
    const token=jwt.sign({id:String(photoId)}, process.env.IMG_TOKEN_SECRET, {expiresIn:IMG_TOKEN_TTL});
    const imageUrl=`${base(req)}/images/${photoId}?token=${token}`;

    const {data:ai}=await axios.post(`${process.env.AI_BASE_URL}/predict`,
      {image_url:imageUrl, photo_id:Number(photoId), user_id:userId},{timeout:AI_TIMEOUT});

    const time=ai.time_label||ai.time||null;
    const back=ai.background||ai.scene||ai.category||null;
    const emo =ai.emotion||ai.final_emotion||ai.rule_emotion||null;

    const {main_mood,sub_mood}=await resolveMood(client,time,back,emo,{main_mood:ai.mood||ai.mood_main, sub_mood:ai.mood_sub});

    await client.query("DELETE FROM photo_analysis WHERE photo_id=$1",[photoId]);
    await client.query(
      `INSERT INTO photo_analysis (photo_id,time_label,background,emotion,main_mood,sub_mood,analyzed_at)
       VALUES ($1,$2,$3,$4,$5,$6,now())`,
      [photoId,time,back,emo,main_mood,sub_mood]
    );

    await client.query("COMMIT");
    res.json({ok:true, photo_id:Number(photoId), analysis:{time_label:time,background:back,emotion:emo,main_mood,sub_mood}});
  }catch(err){
    await client.query("ROLLBACK");
    const raw=(err&&err.response&&err.response.data)||err?.message||err?.toString()||"unknown error";
    const detail=typeof raw==="string"?raw:JSON.stringify(raw);
    console.error("[analyze by id FAILED]",{detail, ai_url:`${process.env.AI_BASE_URL}/predict`});
    res.status(500).json({error:"analyze by id failed", detail, from:"routes/photos.js#byId"});
  }finally{ client.release(); }
});

module.exports=router;
