/**
 * CF763 Interactive Categorized SVG Mind Map
 * 零外部依賴的高效能互動心智圖（支援雙側輻射／右側樹狀、縮放拖曳、分層展開、關鍵字搜尋自動展開與即時朗讀）
 */
(function (global) {
  "use strict";

  const SVG_NS = "http://www.w3.org/2000/svg";

  function el(tag, attrs = {}, text = null) {
    const node = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v !== undefined && v !== null) node.setAttribute(k, String(v));
    }
    if (text !== null) node.textContent = text;
    return node;
  }

  function truncate(str, maxLen) {
    if (!str) return "";
    return str.length > maxLen ? str.slice(0, maxLen - 1) + "…" : str;
  }

  class MindMapController {
    constructor(containerEl, options = {}) {
      this.container = containerEl;
      this.data = options.data;
      this.getMastery = options.getMastery || (() => "new");
      this.onSelectNode = options.onSelectNode || (() => {});
      this.onSpeakTerm = options.onSpeakTerm || (() => {});

      this.layoutMode = "radial"; // 'radial' | 'tree'
      this.filterMode = "all"; // 'all' | 'A' | 'flagged' | 'review'
      this.searchQuery = "";

      this.expandedCats = new Set(); // cat.id
      this.expandedSubs = new Set(); // `${cat.id}||${subName}`
      this.expandedFullSubs = new Set(); // subcategories where user clicked "show all"
      this.selectedKey = "root";

      // Pan & zoom state
      this.tx = 0;
      this.ty = 0;
      this.scale = 0.85;
      this.isDragging = false;
      this.dragStart = { x: 0, y: 0, tx: 0, ty: 0 };

      this._initSVG();
      this._bindEvents();
      this.render(true);
    }

    _initSVG() {
      this.container.innerHTML = "";
      this.svg = el("svg", {
        class: "mm-svg",
        width: "100%",
        height: "100%",
      });
      this.viewport = el("g", { class: "mm-viewport" });
      this.edgesGroup = el("g", { class: "mm-edges" });
      this.nodesGroup = el("g", { class: "mm-nodes" });
      this.viewport.appendChild(this.edgesGroup);
      this.viewport.appendChild(this.nodesGroup);
      this.svg.appendChild(this.viewport);
      this.container.appendChild(this.svg);
    }

    _bindEvents() {
      this.svg.addEventListener("mousedown", (e) => {
        if (e.button !== 0) return;
        if (e.target.closest(".mm-node")) return;
        this.isDragging = true;
        this.svg.classList.add("grabbing");
        this.dragStart = { x: e.clientX, y: e.clientY, tx: this.tx, ty: this.ty };
      });

      window.addEventListener("mousemove", (e) => {
        if (!this.isDragging) return;
        this.tx = this.dragStart.tx + (e.clientX - this.dragStart.x);
        this.ty = this.dragStart.ty + (e.clientY - this.dragStart.y);
        this._applyTransform();
      });

      window.addEventListener("mouseup", () => {
        if (!this.isDragging) return;
        this.isDragging = false;
        this.svg.classList.remove("grabbing");
      });

      this.svg.addEventListener(
        "wheel",
        (e) => {
          e.preventDefault();
          const rect = this.svg.getBoundingClientRect();
          const mx = e.clientX - rect.left;
          const my = e.clientY - rect.top;
          const factor = e.deltaY < 0 ? 1.12 : 0.89;
          this.zoomAt(mx, my, factor);
        },
        { passive: false }
      );

      // Touch pan
      let touchStart = null;
      this.svg.addEventListener(
        "touchstart",
        (e) => {
          if (e.touches.length === 1 && !e.target.closest(".mm-node")) {
            touchStart = {
              x: e.touches[0].clientX,
              y: e.touches[0].clientY,
              tx: this.tx,
              ty: this.ty,
            };
          }
        },
        { passive: true }
      );
      this.svg.addEventListener(
        "touchmove",
        (e) => {
          if (!touchStart || e.touches.length !== 1) return;
          this.tx = touchStart.tx + (e.touches[0].clientX - touchStart.x);
          this.ty = touchStart.ty + (e.touches[0].clientY - touchStart.y);
          this._applyTransform();
        },
        { passive: true }
      );
      this.svg.addEventListener("touchend", () => {
        touchStart = null;
      });
    }

    zoomAt(cx, cy, factor) {
      const nextScale = Math.max(0.22, Math.min(2.4, this.scale * factor));
      const ratio = nextScale / this.scale;
      this.tx = cx - (cx - this.tx) * ratio;
      this.ty = cy - (cy - this.ty) * ratio;
      this.scale = nextScale;
      this._applyTransform();
    }

    zoomBy(factor) {
      const rect = this.svg.getBoundingClientRect();
      this.zoomAt(rect.width / 2, rect.height / 2, factor);
    }

    _applyTransform() {
      this.viewport.setAttribute("transform", `translate(${this.tx.toFixed(1)}, ${this.ty.toFixed(1)}) scale(${this.scale.toFixed(3)})`);
    }

    setLayout(mode) {
      this.layoutMode = mode;
      this.render(true);
    }

    setFilter(filterMode) {
      this.filterMode = filterMode;
      this.render(true);
    }

    setSearch(query) {
      const q = (query || "").trim().toLowerCase();
      this.searchQuery = q;
      if (q) {
        // 自動展開前幾個符合搜尋的分類與子分類
        this.expandedCats.clear();
        this.expandedSubs.clear();
        const filtered = this._getFilteredTerms();
        const catOrder = [];
        const subPairs = new Map();
        for (const t of filtered) {
          if (!subPairs.has(t.cat)) {
            catOrder.push(t.cat);
            subPairs.set(t.cat, new Set());
          }
          subPairs.get(t.cat).add(t.sub);
        }
        catOrder.slice(0, 4).forEach((cid) => {
          this.expandedCats.add(cid);
          Array.from(subPairs.get(cid))
            .slice(0, 4)
            .forEach((sub) => this.expandedSubs.add(`${cid}||${sub}`));
        });
      }
      this.render(true);
    }

    expandAllCategories() {
      this.data.categories.forEach((c) => this.expandedCats.add(c.id));
      this.render(true);
    }

    collapseAll() {
      this.expandedCats.clear();
      this.expandedSubs.clear();
      this.expandedFullSubs.clear();
      this.render(true);
    }

    focusCategory(catId) {
      this.expandedCats.add(catId);
      this.selectedKey = `cat:${catId}`;
      this.render(false);
      const cat = this.data.categories.find((c) => c.id === catId);
      if (cat) {
        const terms = this._getFilteredTerms().filter((t) => t.cat === catId);
        this.onSelectNode({ type: "category", category: cat, terms });
      }
      this.fitToView();
    }

    _getFilteredTerms() {
      const q = this.searchQuery;
      return this.data.terms.filter((t) => {
        if (this.filterMode === "A" && t.imp !== "A") return false;
        if (this.filterMode === "flagged" && !t.flag) return false;
        if (this.filterMode === "review" && this.getMastery(t.id) !== "review") return false;
        if (q) {
          const hay = `${t.jp} ${t.kana} ${t.zh} ${t.en} ${t.sub} ${t.usage}`.toLowerCase();
          if (!hay.includes(q)) return false;
        }
        return true;
      });
    }

    _buildTreeData() {
      const filtered = this._getFilteredTerms();
      const byCat = new Map();
      for (const t of filtered) {
        if (!byCat.has(t.cat)) byCat.set(t.cat, []);
        byCat.get(t.cat).push(t);
      }

      const catNodes = [];
      for (const cat of this.data.categories) {
        const terms = byCat.get(cat.id) || [];
        if (terms.length === 0 && (this.searchQuery || this.filterMode !== "all")) continue;

        const isCatExpanded = this.expandedCats.has(cat.id);
        const subChildren = [];

        if (isCatExpanded) {
          const bySub = new Map();
          for (const t of terms) {
            if (!bySub.has(t.sub)) bySub.set(t.sub, []);
            bySub.get(t.sub).push(t);
          }
          const sortedSubs = Array.from(bySub.entries()).sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));

          for (const [subName, subTerms] of sortedSubs) {
            const subKey = `${cat.id}||${subName}`;
            const isSubExpanded = this.expandedSubs.has(subKey);
            const termChildren = [];

            if (isSubExpanded) {
              const showAll = this.expandedFullSubs.has(subKey);
              const limit = showAll ? subTerms.length : 35;
              const slice = subTerms.slice(0, limit);
              for (const term of slice) {
                termChildren.push({
                  key: `term:${term.id}`,
                  type: "term",
                  color: cat.color,
                  term,
                  category: cat,
                  subName,
                  w: 256,
                  h: 34,
                  children: [],
                });
              }
              if (subTerms.length > limit) {
                termChildren.push({
                  key: `more:${subKey}`,
                  type: "more",
                  color: cat.color,
                  subKey,
                  remaining: subTerms.length - limit,
                  w: 170,
                  h: 30,
                  children: [],
                });
              }
            }

            subChildren.push({
              key: `sub:${subKey}`,
              subKey,
              type: "subcategory",
              name: subName,
              count: subTerms.length,
              color: cat.color,
              category: cat,
              terms: subTerms,
              expanded: isSubExpanded,
              w: 218,
              h: 36,
              children: termChildren,
            });
          }
        }

        const mastered = terms.filter((t) => this.getMastery(t.id) === "mastered").length;
        catNodes.push({
          key: `cat:${cat.id}`,
          type: "category",
          category: cat,
          count: terms.length,
          mastered,
          color: cat.color,
          terms,
          expanded: isCatExpanded,
          w: 238,
          h: 44,
          children: subChildren,
        });
      }

      return {
        key: "root",
        type: "root",
        title: "CF763 工程術語",
        subtitle: `${filtered.length} 筆 / ${catNodes.length} 分類`,
        totalFiltered: filtered.length,
        color: "#0f172a",
        w: 210,
        h: 64,
        children: catNodes,
      };
    }

    _layoutSubtree(node, dir, depth, startY) {
      const GAP_Y = depth === 0 ? 14 : depth === 1 ? 10 : 6;
      const GAP_X = depth === 0 ? 74 : depth === 1 ? 54 : 44;

      if (!node.children || node.children.length === 0) {
        node.y = startY + node.h / 2;
        node.subtreeH = node.h;
        return node.subtreeH;
      }

      let cursorY = startY;
      for (let i = 0; i < node.children.length; i++) {
        const child = node.children[i];
        child.dir = dir;
        child.depth = depth + 1;
        const ch = this._layoutSubtree(child, dir, depth + 1, cursorY);
        cursorY += ch + (i < node.children.length - 1 ? GAP_Y : 0);
      }

      const totalChildrenH = cursorY - startY;
      node.subtreeH = Math.max(node.h, totalChildrenH);
      const firstChild = node.children[0];
      const lastChild = node.children[node.children.length - 1];
      node.y = (firstChild.y + lastChild.y) / 2;

      // Assign x recursively after root x is known
      const assignX = (parent, parentRightOrLeft) => {
        const g = parent.depth === 0 ? 74 : parent.depth === 1 ? 54 : 44;
        for (const c of parent.children || []) {
          c.x = parentRightOrLeft + dir * (g + c.w / 2);
          assignX(c, c.x + dir * (c.w / 2));
        }
      };

      if (depth === 0) {
        node.x = 0;
        assignX(node, dir * (node.w / 2));
      }

      return node.subtreeH;
    }

    _computeLayout(root) {
      root.depth = 0;
      root.x = 0;
      root.y = 0;
      root.dir = 0;

      if (this.layoutMode === "tree" || root.children.length <= 2) {
        // All on right
        this._layoutSubtree(root, 1, 0, 0);
        // Shift y so root is at 0
        const dy = -root.y;
        this._shiftY(root, dy);
        return;
      }

      // Radial balanced: split categories left & right
      const mid = Math.ceil(root.children.length / 2);
      const leftCats = root.children.slice(0, mid);
      const rightCats = root.children.slice(mid);

      const layoutSide = (list, dir) => {
        const dummy = { ...root, children: list, depth: 0 };
        this._layoutSubtree(dummy, dir, 0, 0);
        const dy = -dummy.y;
        list.forEach((c) => this._shiftY(c, dy));
      };

      layoutSide(leftCats, -1);
      layoutSide(rightCats, 1);
    }

    _shiftY(node, dy) {
      node.y += dy;
      for (const c of node.children || []) {
        this._shiftY(c, dy);
      }
    }

    render(shouldFit = false) {
      const root = this._buildTreeData();
      this._computeLayout(root);

      this.edgesGroup.innerHTML = "";
      this.nodesGroup.innerHTML = "";

      const bounds = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity };
      const updateBounds = (n) => {
        bounds.minX = Math.min(bounds.minX, n.x - n.w / 2);
        bounds.maxX = Math.max(bounds.maxX, n.x + n.w / 2);
        bounds.minY = Math.min(bounds.minY, n.y - n.h / 2);
        bounds.maxY = Math.max(bounds.maxY, n.y + n.h / 2);
      };

      const drawBranch = (parent) => {
        updateBounds(parent);
        for (const child of parent.children || []) {
          const dir = child.dir || 1;
          const x1 = parent.x + dir * (parent.w / 2);
          const y1 = parent.y;
          const x2 = child.x - dir * (child.w / 2);
          const y2 = child.y;
          const cx = (x1 + x2) / 2;

          const path = el("path", {
            d: `M ${x1} ${y1} C ${cx} ${y1}, ${cx} ${y2}, ${x2} ${y2}`,
            fill: "none",
            stroke: child.color || "#94a3b8",
            "stroke-width": child.type === "category" ? 2.4 : child.type === "subcategory" ? 1.8 : 1.2,
            "stroke-opacity": child.type === "term" ? 0.5 : 0.72,
            class: "mm-edge",
          });
          this.edgesGroup.appendChild(path);
          drawBranch(child);
        }
        this._drawNode(parent);
      };

      drawBranch(root);
      this._lastBounds = bounds;

      if (shouldFit) {
        this.fitToView();
      } else {
        this._applyTransform();
      }
    }

    _drawNode(node) {
      const isSelected = this.selectedKey === node.key;
      const g = el("g", {
        class: `mm-node mm-node-${node.type} ${isSelected ? "is-selected" : ""}`,
        transform: `translate(${(node.x - node.w / 2).toFixed(1)}, ${(node.y - node.h / 2).toFixed(1)})`,
      });

      if (node.type === "root") {
        g.appendChild(
          el("rect", {
            width: node.w,
            height: node.h,
            rx: 16,
            class: "mm-root-rect",
          })
        );
        g.appendChild(
          el("text", { x: node.w / 2, y: 27, "text-anchor": "middle", class: "mm-root-title" }, node.title)
        );
        g.appendChild(
          el("text", { x: node.w / 2, y: 47, "text-anchor": "middle", class: "mm-root-sub" }, node.subtitle)
        );
        g.addEventListener("click", (e) => {
          e.stopPropagation();
          this.selectedKey = "root";
          this.onSelectNode({ type: "root", totalFiltered: node.totalFiltered });
          this.render(false);
        });
      } else if (node.type === "category") {
        const rect = el("rect", {
          width: node.w,
          height: node.h,
          rx: 11,
          class: "mm-cat-rect",
          style: `--cat-color: ${node.color};`,
        });
        g.appendChild(rect);

        // Left accent bar
        g.appendChild(
          el("rect", {
            x: 0,
            y: 0,
            width: 7,
            height: node.h,
            rx: 3,
            fill: node.color,
          })
        );

        // Code + Name
        g.appendChild(
          el(
            "text",
            { x: 16, y: 20, class: "mm-cat-title" },
            `${node.category.code} ${truncate(node.category.name, 13)}`
          )
        );

        // Sub-line: count + mastered
        const pct = node.count > 0 ? Math.round((node.mastered / node.count) * 100) : 0;
        g.appendChild(
          el(
            "text",
            { x: 16, y: 36, class: "mm-cat-meta" },
            `${node.count} 詞 · 已熟記 ${pct}%`
          )
        );

        // Expand/collapse indicator pill
        const badgeX = node.dir === -1 ? -11 : node.w + 11;
        g.appendChild(
          el("circle", {
            cx: badgeX,
            cy: node.h / 2,
            r: 9,
            fill: node.expanded ? node.color : "#ffffff",
            stroke: node.color,
            "stroke-width": 2,
            class: "mm-toggle-dot",
          })
        );
        g.appendChild(
          el(
            "text",
            {
              x: badgeX,
              y: node.h / 2 + 4,
              "text-anchor": "middle",
              fill: node.expanded ? "#ffffff" : node.color,
              class: "mm-toggle-sign",
            },
            node.expanded ? "−" : "+"
          )
        );

        g.addEventListener("click", (e) => {
          e.stopPropagation();
          if (this.expandedCats.has(node.category.id)) {
            this.expandedCats.delete(node.category.id);
          } else {
            this.expandedCats.add(node.category.id);
          }
          this.selectedKey = node.key;
          this.onSelectNode({ type: "category", category: node.category, terms: node.terms });
          this.render(false);
        });
      } else if (node.type === "subcategory") {
        g.appendChild(
          el("rect", {
            width: node.w,
            height: node.h,
            rx: 9,
            class: "mm-sub-rect",
            style: `--cat-color: ${node.color};`,
          })
        );
        g.appendChild(
          el("text", { x: 12, y: 22, class: "mm-sub-title" }, truncate(node.name, 13))
        );
        // Count badge
        g.appendChild(
          el("rect", {
            x: node.w - 42,
            y: 8,
            width: 34,
            height: 20,
            rx: 10,
            fill: node.color,
            "fill-opacity": 0.14,
          })
        );
        g.appendChild(
          el(
            "text",
            {
              x: node.w - 25,
              y: 22,
              "text-anchor": "middle",
              fill: node.color,
              class: "mm-sub-count",
            },
            String(node.count)
          )
        );

        const badgeX = node.dir === -1 ? -9 : node.w + 9;
        g.appendChild(
          el("circle", {
            cx: badgeX,
            cy: node.h / 2,
            r: 7.5,
            fill: node.expanded ? node.color : "#ffffff",
            stroke: node.color,
            "stroke-width": 1.6,
          })
        );
        g.appendChild(
          el(
            "text",
            {
              x: badgeX,
              y: node.h / 2 + 3.5,
              "text-anchor": "middle",
              fill: node.expanded ? "#ffffff" : node.color,
              class: "mm-toggle-sign-sm",
            },
            node.expanded ? "−" : "+"
          )
        );

        g.addEventListener("click", (e) => {
          e.stopPropagation();
          if (this.expandedSubs.has(node.subKey)) {
            this.expandedSubs.delete(node.subKey);
          } else {
            this.expandedSubs.add(node.subKey);
          }
          this.selectedKey = node.key;
          this.onSelectNode({
            type: "subcategory",
            category: node.category,
            subName: node.name,
            terms: node.terms,
          });
          this.render(false);
        });
      } else if (node.type === "term") {
        const mastery = this.getMastery(node.term.id);
        const isMatch = Boolean(this.searchQuery);
        g.appendChild(
          el("rect", {
            width: node.w,
            height: node.h,
            rx: 8,
            class: `mm-term-rect ${mastery === "mastered" ? "is-mastered" : ""} ${mastery === "review" ? "is-review" : ""} ${isMatch ? "is-match" : ""}`,
            style: `--cat-color: ${node.color};`,
          })
        );

        // Priority dot
        if (node.term.imp === "A") {
          g.appendChild(el("circle", { cx: 11, cy: node.h / 2, r: 3.5, fill: "#ef4444" }));
        } else if (node.term.flag) {
          g.appendChild(el("circle", { cx: 11, cy: node.h / 2, r: 3.5, fill: "#f59e0b" }));
        } else {
          g.appendChild(el("circle", { cx: 11, cy: node.h / 2, r: 3, fill: node.color, "fill-opacity": 0.45 }));
        }

        const label = `${truncate(node.term.jp, 12)} · ${truncate(node.term.zh, 9)}`;
        g.appendChild(el("text", { x: 20, y: 21.5, class: "mm-term-text" }, label));

        // Quick speak button on the right
        const spkGroup = el("g", { class: "mm-speak-btn", transform: `translate(${node.w - 26}, 6)` });
        spkGroup.appendChild(el("rect", { width: 22, height: 22, rx: 6, class: "mm-speak-bg" }));
        spkGroup.appendChild(el("text", { x: 11, y: 15, "text-anchor": "middle", class: "mm-speak-icon" }, "🔊"));
        spkGroup.addEventListener("click", (e) => {
          e.stopPropagation();
          this.onSpeakTerm(node.term);
        });
        g.appendChild(spkGroup);

        g.addEventListener("click", (e) => {
          e.stopPropagation();
          this.selectedKey = node.key;
          this.onSelectNode({ type: "term", term: node.term, category: node.category });
          this.render(false);
        });
      } else if (node.type === "more") {
        g.appendChild(
          el("rect", {
            width: node.w,
            height: node.h,
            rx: 8,
            class: "mm-more-rect",
          })
        );
        g.appendChild(
          el("text", { x: node.w / 2, y: 19, "text-anchor": "middle", class: "mm-more-text" }, `展開剩餘 +${node.remaining} 筆`)
        );
        g.addEventListener("click", (e) => {
          e.stopPropagation();
          this.expandedFullSubs.add(node.subKey);
          this.render(false);
        });
      }

      this.nodesGroup.appendChild(g);
    }

    fitToView() {
      const b = this._lastBounds;
      if (!b || !isFinite(b.minX)) return;
      const rect = this.svg.getBoundingClientRect();
      if (!rect.width || !rect.height) return;

      const pad = 44;
      const bw = Math.max(100, b.maxX - b.minX);
      const bh = Math.max(100, b.maxY - b.minY);
      const s = Math.min((rect.width - pad * 2) / bw, (rect.height - pad * 2) / bh, 1.15);
      this.scale = Math.max(0.25, s);
      const cx = (b.minX + b.maxX) / 2;
      const cy = (b.minY + b.maxY) / 2;
      this.tx = rect.width / 2 - cx * this.scale;
      this.ty = rect.height / 2 - cy * this.scale;
      this._applyTransform();
    }
  }

  global.CF763MindMap = MindMapController;
})(window);
