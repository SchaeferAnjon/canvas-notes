import type { MiddleJson } from '../src'

/** 照本机 MinerU 4.0.12 对 arXiv 1512.03385v1 解析出来的结构造的（第 3、5 页的样子），字换成自己写的 */
export const MIDDLE: MiddleJson = {
  schema: 'docvortex.middle',
  extensions: {
    docvortex_layout: {
      pages: [
        { page_idx: 2, width_pt: 612, height_pt: 792 },
        { page_idx: 4, width_pt: 612, height_pt: 792 },
      ],
    },
  },
  pages: [
    {
      page_idx: 2,
      blocks: [
        { type: 'aside_text', index: 0, bbox: [0.02, 0.26, 0.06, 0.7], content: [{ type: 'text', content: 'arXiv:0000.00000v1' }] },
        { type: 'paragraph_title', index: 1, bbox: [0.08, 0.1, 0.3, 0.12], level: 2, content: [{ type: 'text', content: '3. Residual Learning' }] },
        {
          type: 'text',
          index: 2,
          bbox: [0.08, 0.13, 0.47, 0.3],
          content: [
            { type: 'text', content: 'Let us consider ' },
            { type: 'equation_inline', content: '\\mathcal { H } ( \\mathbf { x } )' },
            { type: 'text', content: ' , an underlying mapping.' },
          ],
        },
        { type: 'equation', index: 3, bbox: [0.2, 0.79, 0.47, 0.81], content: '\\mathbf { y } = \\mathcal { F } ( \\mathbf { x } ) + \\mathbf { x } .\\tag{1}' },
        {
          type: 'image',
          index: 4,
          bbox: [0.55, 0.1, 0.9, 0.3],
          content: [
            { type: 'image_body', index: 4, bbox: [0.55, 0.1, 0.9, 0.3], content: '' },
            { type: 'image_caption', index: 5, bbox: [0.53, 0.31, 0.92, 0.33], content: [{ type: 'text', content: 'Figure 2. A building block.' }] },
          ],
        },
        { type: 'page_number', index: 6, bbox: [0.48, 0.92, 0.5, 0.94], content: [{ type: 'text', content: '3' }] },
      ],
    },
    {
      page_idx: 4,
      blocks: [
        {
          type: 'table',
          index: 0,
          bbox: [0.2, 0.09, 0.77, 0.28],
          content: [
            {
              type: 'table_body',
              index: 0,
              bbox: [0.2, 0.09, 0.77, 0.28],
              content: '<table><tbody><tr><td>layer</td><td>size</td><td>18-layer</td></tr><tr><td>conv1</td><td>112×112</td><td colspan="1">7×7, 64</td></tr><tr><td>conv2_x</td><td>56×56</td><td>3×3 max pool &amp; more</td></tr></tbody></table>',
            },
            { type: 'table_caption', index: 1, bbox: [0.08, 0.29, 0.89, 0.31], content: [{ type: 'text', content: 'Table 1. Architectures.' }] },
          ],
        },
        {
          type: 'chart',
          index: 2,
          bbox: [0.14, 0.32, 0.47, 0.49],
          content: [{ type: 'chart_body', index: 2, bbox: [0.14, 0.32, 0.47, 0.49], content: '' }],
        },
        {
          type: 'table',
          index: 3,
          bbox: [0.15, 0.56, 0.4, 0.6],
          content: [
            { type: 'table_caption', index: 3, bbox: [0.08, 0.53, 0.47, 0.55], content: [{ type: 'text', content: 'Table 2. Top-1 error.' }] },
            { type: 'table_body', index: 4, bbox: [0.15, 0.56, 0.4, 0.6], content: '<table><tr><th></th><th>plain</th></tr><tr><td rowspan="2">18 layers</td><td>27.94</td></tr></table>' },
          ],
        },
        {
          type: 'page_footnote',
          index: 5,
          bbox: [0.5, 0.86, 0.9, 0.9],
          content: [
            { type: 'text', content: '3', styles: ['superscript'] },
            { type: 'hyperlink', url: 'http://example.org', content: [{ type: 'text', content: 'example.org' }] },
          ],
        },
        { type: 'footer', index: 6, bbox: [0.1, 0.95, 0.9, 0.97], content: [{ type: 'text', content: 'Conference 2016' }] },
      ],
    },
  ],
}
