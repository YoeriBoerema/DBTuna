# Database diagram routing

Table placement uses the existing grouped ELK layout. `webview/relationships/router.ts` is an independent routing pass; no yFiles code, license or runtime is used.

Published background:

- Wybrow, Marriott and Stuckey, [Orthogonal Connector Routing](https://users.monash.edu/~mwybrow/papers/wybrow-gd-2009.pdf): rectilinear visibility search, direction-aware A*, and separation of shared routes.
- yWorks, [Orthogonal Edge Routing](https://docs.yworks.com/yfiles/doc/developers-guide/orthogonal_edge_router.html): crossing costs and rerouting high-conflict connections.

This implementation uses a bounded rectilinear grid rather than reproducing libavoid's full visibility graph and constraint-based nudging solver. Candidate coordinates come from table margins, existing bends and parallel lanes 12 px away from existing routes. A* state includes incoming direction, and scores distance, bends, crossings, collinear overlaps and tightly adjacent parallel segments. Table interiors are impassable. First/last segments must retain their chosen column-port directions.

The router prioritizes expensive connections, then makes a second pass. A candidate replaces a route only if its local cost improves and its geometry passes obstacle, endpoint and port-direction checks. For an initially valid diagram, a final comparison retains the original routes if the weighted global score or proper-crossing count gets worse. Thus this pass cannot guarantee a globally optimal or crossing-free drawing.

Search is bounded to 100 nearby obstacles, 18,000 grid points, 40,000 expansions per request, 500 requests total and a 2.5-second search budget. It yields between small batches and supports cancellation when the graph changes or the viewer closes. Routes not improved within the budget retain their original geometry. These limits apply to the optimization search, not ELK placement or initial metric calculation.

**Reroute lines** reads current table positions, reconnects the existing route sketches to current column anchors, and runs this pass without calling ELK or modifying node positions. It applies the result only when every connection is valid. If tables are too close or the bounded search cannot find a safe path, the viewer retains its current lines and asks the user to move tables or use **Auto layout**.

Regression coverage includes left/right and self-reference anchors, wrapped table sizes, a multi-schema cyclic graph, obstacle avoidance, crossing reduction, shared-lane reduction, cancellation, selection highlighting and rerouting after a browser drag. Benchmark metrics describe synthetic fixtures, not a guarantee for arbitrary databases.
