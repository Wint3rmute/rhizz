import { useEffect, useRef, useState } from "react";
import * as Viz from "@viz-js/viz";

export function Graph({ graphviz_input }: { graphviz_input: string }) {
  const graph_ref = useRef<HTMLParagraphElement>(null);
  const [graph_loading_state, set_graph_loading_state] = useState<string>();

  useEffect(() => {
    Viz.instance().then((viz) => {
      try {
        const svg = viz.renderSVGElement(graphviz_input, { engine: "dot" });

        const parent = graph_ref.current;
        if (!parent) {
          // TODO: raise error?
          return;
        }

        if (parent.firstChild) {
          parent.replaceChild(svg, parent.firstChild);
        } else {
          parent.appendChild(svg);
        }
        set_graph_loading_state("");
      } catch (e) {
        set_graph_loading_state(`${e} whiile rendering "${graphviz_input}"`);
      }
    });
  }, [graphviz_input]);

  return (
    <>
      <p ref={graph_ref}>
      </p>
      <p>
        {graph_loading_state}
      </p>
    </>
  );
}
