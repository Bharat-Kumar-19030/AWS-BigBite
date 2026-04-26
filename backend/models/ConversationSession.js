import mongoose from 'mongoose';

const messageSchema = new mongoose.Schema({
  role: {
    type: String,
    enum: ['human', 'ai', 'tool'],
    required: true,
  },
  content: {
    type: String,
    required: true,
  },
  toolName: {
    type: String,
    default: null,
  },
  timestamp: {
    type: Date,
    default: Date.now,
  },
});

const conversationSessionSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    title: {
      type: String,
      default: 'New Conversation',
    },
    messages: [messageSchema],
    sessionMetadata: {
      lastToolUsed: { type: String, default: null },
      messageCount: { type: Number, default: 0 },
    },
  },
  { timestamps: true }
);

// Index for fast user queries
conversationSessionSchema.index({ user: 1, updatedAt: -1 });

const ConversationSession = mongoose.model('ConversationSession', conversationSessionSchema);

export default ConversationSession;
