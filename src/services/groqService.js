const Groq = require("groq-sdk");
const fs = require("fs");
require("dotenv").config();

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const processText = async (
  prompt,
  systemMessage = "Eres un asistente de gestión de ventas.",
) => {
  try {
    const chatCompletion = await groq.chat.completions.create({
      messages: [
        { role: "system", content: systemMessage },
        { role: "user", content: prompt },
      ],
      model: "llama-3.3-70b-versatile",
      temperature: 0.5,
    });
    return chatCompletion.choices[0]?.message?.content || "";
  } catch (error) {
    console.error("Error en Groq API:", error);
    throw error;
  }
};

const transcribeAudio = async (filePath) => {
  try {
    const transcription = await groq.audio.transcriptions.create({
      file: fs.createReadStream(filePath),
      model: "whisper-large-v3",
      response_format: "json",
      language: "es", // Forzamos español para mayor precisión
    });
    return transcription.text;
  } catch (error) {
    console.error("Error transcribiendo el audio en Groq:", error);
    throw error;
  }
};
// La función de visión la conectaremos más adelante cuando procesemos las fotos
const processImage = async (imageUrl, prompt) => {
  // Aquí irá la lógica para llama-3.2-11b-vision-preview
};

module.exports = { processText, processImage, transcribeAudio };
