import "react";

// <s-app-nav> comes from Shopify App Bridge, which does not ship React types for it.
declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      "s-app-nav": React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement>;
    }
  }
}
