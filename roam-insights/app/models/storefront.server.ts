import db from "../db.server";
import { activityLog } from "../db/schema";

type AdminGraphql = (query: string, options?: { variables?: Record<string, unknown> }) => Promise<Response>;

// The storefront's "Tell us about you" flow lives on this page. The theme links
// to /pages/find-my-gear and provides the matching page template.
export const QUIZ_PAGE = { title: "Find my gear", handle: "find-my-gear", templateSuffix: "find-my-gear" };

const FIND_PAGE = `#graphql
  query RoamQuizPage($query: String!) {
    pages(first: 10, query: $query) {
      nodes {
        id
        handle
        templateSuffix
      }
    }
  }
`;

const DELETE_PAGE = `#graphql
  mutation RoamDeleteQuizPageCopy($id: ID!) {
    pageDelete(id: $id) {
      deletedPageId
      userErrors {
        message
      }
    }
  }
`;

const CREATE_PAGE = `#graphql
  mutation RoamCreateQuizPage($page: PageCreateInput!) {
    pageCreate(page: $page) {
      page {
        id
        handle
      }
      userErrors {
        field
        message
      }
    }
  }
`;

/*
 * Makes sure the store has the "Find my gear" page. The merchant should not
 * have to create a page by hand for the app's storefront feature to work.
 * Returns "exists", "created", or an error message.
 */
// Two requests can arrive at the same moment (the admin loads the app twice on
// first open). Sharing one in-flight check per shop stops both from creating a page.
const inFlight = new Map<string, Promise<string>>();

export function ensureQuizPage(graphql: AdminGraphql, shop: string): Promise<string> {
  const running = inFlight.get(shop);
  if (running) return running;

  const check = ensureQuizPageOnce(graphql, shop).finally(() => inFlight.delete(shop));
  inFlight.set(shop, check);
  return check;
}

async function ensureQuizPageOnce(graphql: AdminGraphql, shop: string): Promise<string> {
  try {
    const found = await graphql(FIND_PAGE, { variables: { query: `title:'${QUIZ_PAGE.title}'` } });
    const foundBody = (await found.json()) as {
      data?: { pages: { nodes: { id: string; handle: string; templateSuffix: string | null }[] } };
    };
    const pages = foundBody.data?.pages.nodes ?? [];

    if (pages.some((page) => page.handle === QUIZ_PAGE.handle)) {
      // Tidy up accidental copies the app itself made (handles like find-my-gear-1).
      const copies = pages.filter(
        (page) => page.handle.startsWith(`${QUIZ_PAGE.handle}-`) && page.templateSuffix === QUIZ_PAGE.templateSuffix,
      );
      for (const copy of copies) {
        await graphql(DELETE_PAGE, { variables: { id: copy.id } });
      }
      return "exists";
    }

    const created = await graphql(CREATE_PAGE, {
      variables: { page: { ...QUIZ_PAGE, body: "", isPublished: true } },
    });
    const createdBody = (await created.json()) as {
      data?: { pageCreate: { page: { id: string } | null; userErrors: { message: string }[] } };
    };
    const errors = createdBody.data?.pageCreate.userErrors ?? [];
    if (errors.length > 0 || !createdBody.data?.pageCreate.page) {
      return errors.map((error) => error.message).join("; ") || "Could not create the page";
    }

    await db.insert(activityLog).values({
      shop,
      actor: "system",
      action: "storefront.page_created",
      summary: `Created the "${QUIZ_PAGE.title}" page for the storefront quiz`,
      details: { handle: QUIZ_PAGE.handle, templateSuffix: QUIZ_PAGE.templateSuffix },
    });
    return "created";
  } catch (error) {
    return error instanceof Error ? error.message : "Could not check the page";
  }
}
