import dotenv from "dotenv";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { createAgent, tool, initChatModel } from "langchain";
import { MemorySaver } from "@langchain/langgraph";
import * as z from "zod";
import PromptSync from "prompt-sync";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: resolve(__dirname, "../.env") });
console.log(process.env.GROQ_API_KEY)
// Define system prompt 
const systemPrompt = `You are an expert weather forecaster.

You have access to two tools:

- get_weather_for_location: use this to get the weather for a specific location
- get_user_location: use this to get the user's location

Rules:
- If a user asks for weather, make sure you have a location first.
- If the user means "my location", "outside", "here", or similar, call get_user_location first.
- If a user asks their location, call get_user_location and answer with that exact location.
- Do not invent location or weather data; use tools.
- Use a serious, professional, and direct tone.
- Do not use jokes, puns, or playful language.`;

// Define tools
const getWeather = tool(
  ({ city }) => `It's always sunny in ${city}!`,
  {
    name: "get_weather_for_location",
    description: "Get the weather for a given city",
    schema: z.object({
      city: z.string(),
    }),
  }
);

const getUserLocation = tool(
  (_, config) => {
    const { user_id } = config.context;
    return user_id === "1" ? "Florida" : "SF";
  },
  {
    name: "get_user_location",
    description: "Retrieve user information based on user ID",
    schema: z.preprocess((input) => (input == null ? {} : input), z.object({})),
  }
);

// Configure model
const model = await initChatModel(
  "llama-3.3-70b-versatile",
  {
    modelProvider: "groq",
    temperature: 0,
    apiKey: process.env.GROQ_API_KEY,
  }
);

// Define response format
const responseFormat = z.object({
  assistant_response: z.string(),
  user_location: z.string().optional(),
  weather_conditions: z.string().optional(),
});

// Set up memory
const checkpointer = new MemorySaver();

// Create agent
const agent = createAgent({
  model,
  systemPrompt,
  responseFormat,
  checkpointer,
  tools: [getUserLocation, getWeather],
});

// Run agent
// `thread_id` is a unique identifier for a given conversation.
const config = {
  configurable: { thread_id: "1" },
  context: { user_id: "1" },
};

// const response = await agent.invoke(
//   { messages: [{ role: "user", content: "what is the weather outside?" }] },
//   config
// );
// console.log(response.structuredResponse);
// {
//   punny_response: "Florida is still having a 'sun-derful' day! The sunshine is playing 'ray-dio' hits all day long! I'd say it's the perfect weather for some 'solar-bration'! If you were hoping for rain, I'm afraid that idea is all 'washed up' - the forecast remains 'clear-ly' brilliant!",
//   weather_conditions: "It's always sunny in Florida!"
// }

// Note that we can continue the conversation using the same `thread_id`.
// const thankYouResponse = await agent.invoke(
//   { messages: [{ role: "user", content: "thank you!" }] },
//   config
// );
// console.log(thankYouResponse.structuredResponse);
// {
//   punny_response: "You're 'thund-erfully' welcome! It's always a 'breeze' to help you stay 'current' with the weather. I'm just 'cloud'-ing around waiting to 'shower' you with more forecasts whenever you need them. Have a 'sun-sational' day in the Florida sunshine!",
//   weather_conditions: undefined
// }

const prompt = PromptSync();
while(true){
    // console.log("h");
    const userInput = prompt("Ask about the weather (or type 'exit' to quit): ");
    const response = await agent.invoke(
    { messages: [{ role: "user", content: userInput }] },
    config
    );
    console.log(response.structuredResponse);
}