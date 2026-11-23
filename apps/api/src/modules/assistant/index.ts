// `assistant` module: Ask Field Pro. POST /assistant/ask answers questions through the always-on
// home AI server, with the open model as backup. GET /assistant/status reports which is reachable.
// GET /assistant/help searches the built-in help topics, which work with no AI connected
// (Phase F item 28: the assistant is embedded inside tools and falls back to help, never to a
// made-up answer).
import {
  AssistantAskRequestSchema,
  AssistantAskResponseSchema,
  AssistantHelpResponseSchema,
  AssistantStatusResponseSchema,
} from '@fieldline/contracts';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { requireOrg } from '../../http/context';
import { problem } from '../../http/problem';
import { chatOpenModel } from '../../services/open-model';
import { answerQuestion, AssistantUnavailable, DISCLAIMER, probeModelServer } from './assistant';
import { searchHelp } from './help';

const assistantModule: FastifyPluginAsyncZod = async (app) => {
  app.post(
    '/assistant/ask',
    {
      config: { permission: 'search:read', rateLimit: { max: 20, timeWindow: '1 minute' } },
      schema: {
        tags: ['assistant'],
        summary: 'Ask Field Pro: general questions, home-build help and search help',
        body: AssistantAskRequestSchema,
        response: { 200: AssistantAskResponseSchema },
      },
    },
    async (request) => {
      requireOrg(request);
      const { homeAi, openModel } = request.server.config;
      const { question, mode, history, context } = request.body;
      try {
        const result = await answerQuestion(
          { home: homeAi, backup: openModel },
          { question, mode, history, ...(context !== undefined && { context }) },
          (settings, messages) => chatOpenModel(settings, { messages }),
          (error) =>
            request.log.warn({ err: error }, 'assistant model failed, trying the next one'),
        );
        return { ...result, mode, disclaimer: DISCLAIMER };
      } catch (error) {
        if (error instanceof AssistantUnavailable) {
          throw problem(
            'dependency_unavailable',
            'The AI is not reachable right now. If the home server is off, start it and try again.',
            { retryable: true },
          );
        }
        throw error;
      }
    },
  );

  app.get(
    '/assistant/status',
    {
      config: { permission: 'search:read', rateLimit: { max: 30, timeWindow: '1 minute' } },
      schema: {
        tags: ['assistant'],
        summary: 'Which AI servers are reachable for Ask Field Pro',
        response: { 200: AssistantStatusResponseSchema },
      },
    },
    async (request) => {
      requireOrg(request);
      const { homeAi, openModel } = request.server.config;
      const homeServer = homeAi
        ? (await probeModelServer(homeAi))
          ? ('online' as const)
          : ('offline' as const)
        : ('not_configured' as const);
      return {
        homeServer,
        backupModel: openModel ? ('configured' as const) : ('not_configured' as const),
        available: homeServer === 'online' || openModel !== null,
      };
    },
  );

  app.get(
    '/assistant/help',
    {
      config: { permission: 'search:read', rateLimit: { max: 60, timeWindow: '1 minute' } },
      schema: {
        tags: ['assistant'],
        summary: 'Built-in help topics (work with no AI connected)',
        querystring: z.object({
          q: z.string().trim().max(200).default(''),
          tool: z.string().trim().max(64).optional(),
        }),
        response: { 200: AssistantHelpResponseSchema },
      },
    },
    async (request) => {
      requireOrg(request);
      const { homeAi, openModel } = request.server.config;
      return {
        topics: searchHelp(request.query.q, request.query.tool),
        aiAvailable: homeAi !== null || openModel !== null,
      };
    },
  );
};

export default assistantModule;
