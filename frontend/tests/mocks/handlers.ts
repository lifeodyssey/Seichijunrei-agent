import { http, HttpResponse } from "msw";
import {
  SEARCH_RESPONSE,
  CONVERSATIONS_RESPONSE,
  ROUTES_RESPONSE,
  FEEDBACK_RESPONSE,
} from "../fixtures/responses";

const BASE_URL = "http://localhost:8000";

export const handlers = [
  http.post(`${BASE_URL}/v1/runtime`, () => {
    return HttpResponse.json(SEARCH_RESPONSE);
  }),

  http.post(`${BASE_URL}/v1/runtime/stream`, () => {
    return HttpResponse.json(SEARCH_RESPONSE);
  }),

  http.get(`${BASE_URL}/v1/conversations`, () => {
    return HttpResponse.json(CONVERSATIONS_RESPONSE);
  }),

  http.get(`${BASE_URL}/v1/conversations/:sessionId/messages`, () => {
    return HttpResponse.json({ messages: [] });
  }),

  http.get(`${BASE_URL}/v1/routes`, () => {
    return HttpResponse.json(ROUTES_RESPONSE);
  }),

  http.post(`${BASE_URL}/v1/feedback`, () => {
    return HttpResponse.json(FEEDBACK_RESPONSE);
  }),

  http.patch(`${BASE_URL}/v1/conversations/:sessionId`, () => {
    return new HttpResponse(null, { status: 204 });
  }),
];
