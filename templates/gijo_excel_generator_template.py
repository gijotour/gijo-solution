# -*- coding: utf-8 -*-
# GIJO_AS_제품_라인업_구매자_가이드.xlsx 생성기
#
# ⚠⚠ **이 파일을 고쳤으면 반드시 다시 굽는다** — 고객이 받는 것은 이 .py가 아니라 .xlsx다.
#   (2026-09-08 실사고) 없앤 기능(LLM 합성) 문구를 여기서 걷어냈는데 **다시 굽지 않아**,
#   구매자가 실제로 받는 엑셀은 7월 22일 판 그대로 「보안 LLM 합성 화면 (merge.html)」을
#   **제품 내 제공 기능**으로 팔고 있었다. 같은 내용의 HTML은 「❌ 없앤 기능」으로 고쳐져 있어서
#   **두 사본이 정반대를 말하는** 상태였다 — 파는 자리에서 이건 그냥 거짓말이다.
#   그때 「남은 판매 문장 0건」이라 셌던 것도 이 엑셀을 안 세어 성립하지 않았다.
#   굽는 법:  PYTHONUTF8=1 python templates/gijo_excel_generator_template.py
#   굽고 나서 **연 다음 눈으로 확인**한다 — 없앤 기능이 살아 있는 기능처럼 적힌 칸이 없는지.
#
# ⚠ 이 저장소의 자동 게이트는 여기까지 안 온다: wsl-test.sh가 사본에 넣는 것은
#   server/·client/·knowledge/·tools/·mockups/·뿌리 *.md 뿐이라 templates/ 도 .xlsx 도
#   **감시 밖**이다. 그래서 이 문단이 유일한 안전망이다 — 지우지 말 것.
import openpyxl
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
import os

wb = openpyxl.Workbook()

# Fonts & Fills
font_title = Font(name='맑은 고딕', size=15, bold=True, color='1E293B')
font_subtitle = Font(name='맑은 고딕', size=10, italic=True, color='475569')
font_section = Font(name='맑은 고딕', size=12, bold=True, color='0F172A')
font_header = Font(name='맑은 고딕', size=10, bold=True, color='FFFFFF')
font_bold = Font(name='맑은 고딕', size=10, bold=True, color='0F172A')
font_regular = Font(name='맑은 고딕', size=9, color='1E293B')
font_code = Font(name='Consolas', size=9, color='2563EB', bold=True)
font_sales = Font(name='맑은 고딕', size=11, bold=True, color='1E3A8A')

fill_main_header = PatternFill(start_color='1E3A8A', end_color='1E3A8A', fill_type='solid') # Navy
fill_graph_header = PatternFill(start_color='0284C7', end_color='0284C7', fill_type='solid') # Sky Blue
fill_bench_header = PatternFill(start_color='D97706', end_color='D97706', fill_type='solid') # Amber
fill_lite_header = PatternFill(start_color='2563EB', end_color='2563EB', fill_type='solid') # Blue
fill_std_header = PatternFill(start_color='059669', end_color='059669', fill_type='solid') # Green
fill_pro_header = PatternFill(start_color='7C3AED', end_color='7C3AED', fill_type='solid') # Purple
fill_safe = PatternFill(start_color='DCFCE7', end_color='DCFCE7', fill_type='solid') # Soft Green
fill_warn = PatternFill(start_color='FEF9C3', end_color='FEF9C3', fill_type='solid') # Soft Yellow
fill_ban = PatternFill(start_color='FEE2E2', end_color='FEE2E2', fill_type='solid') # Soft Red
fill_zebra = PatternFill(start_color='F8FAFC', end_color='F8FAFC', fill_type='solid')
fill_highlight = PatternFill(start_color='EFF6FF', end_color='EFF6FF', fill_type='solid')
fill_callout = PatternFill(start_color='F0F9FF', end_color='F0F9FF', fill_type='solid')

thin_border = Border(
    left=Side(style='thin', color='CBD5E1'),
    right=Side(style='thin', color='CBD5E1'),
    top=Side(style='thin', color='CBD5E1'),
    bottom=Side(style='thin', color='CBD5E1')
)

align_center = Alignment(horizontal='center', vertical='center', wrap_text=True)
align_left = Alignment(horizontal='left', vertical='center', wrap_text=True)

# ----------------------------------------------------
# Sheet 1: 1. 한눈에 보는 비교
# ----------------------------------------------------
ws1 = wb.active
ws1.title = "1. 한눈에 보는 비교"
ws1.views.sheetView[0].showGridLines = True

ws1['A1'] = "🛡️ GIJO AS 제품 라인업 한눈에 보기 (VRAM 티어 3종)"
ws1['A1'].font = font_title
ws1['A2'] = "* 모든 제품은 동일한 기능(100% 온프레미스)을 제공하며, 상위 티어일수록 '더 빠르고 전문화된 AI 분석관 팀'이 구동됩니다."
ws1['A2'].font = font_subtitle

headers_ws1 = ["구분 항목", "AS Lite (12GB)", "AS Standard (24GB) [추천]", "AS Pro (30GB+)"]
for col_idx, text in enumerate(headers_ws1, start=1):
    cell = ws1.cell(row=4, column=col_idx, value=text)
    cell.font = font_header
    cell.alignment = align_center
    if col_idx == 1: cell.fill = fill_main_header
    elif col_idx == 2: cell.fill = fill_lite_header
    elif col_idx == 3: cell.fill = fill_std_header
    elif col_idx == 4: cell.fill = fill_pro_header

rows_ws1 = [
    ("권장 하드웨어 (GPU)", "12GB VRAM\n(RTX 3060 12G / 4070급)", "24GB VRAM\n(RTX 3090 / 4090급)", "30GB+ VRAM\n(RTX 5090 / A6000급)"),
    ("번들 기본 LLM 구성", "Qwen3-8B Q4 (단일 상주)", "Qwen3-8B + Kanana-1.5-8B (2상주)", "Qwen3-8B + Kanana-1.5-8B + Phi-4/gpt-oss (3상주)"),
    ("GraphRAG 지식 엔진", "bge-m3 벡터 DB + 6대 온톨로지 지식 그래프 (전 티어 기본 탑재)", "bge-m3 벡터 DB + 6대 온톨로지 지식 그래프 (전 티어 기본 탑재)", "bge-m3 벡터 DB + 6대 온톨로지 지식 그래프 (전 티어 기본 탑재)"),
    ("추천 대상 조직", "1인 보안담당자 (겸직 포함)\n소기업 / 초기 파일럿", "2~3인 전담 보안팀\n중견기업 / 금융 자회사 / 대학", "3인 이상 전담팀 및 SOC\n대기업 / 공공기관 / MSP"),
    ("동시 사용자 수", "1 ~ 2명", "3 ~ 5명", "5명 이상 (다수 동시 접속)"),
    ("AI 역할 분리 방식", "단일 AI가 지휘 및 분석 겸임", "지휘관 AI + 보안전문가 AI (2분업)", "지휘관 + 보안전문가 + 리포트/코드 (3분업)"),
    ("AI 응답 대기시간", "작업 전환 시 15~30초 로드 대기", "상주 2종 즉시 응답 (대기 없음)", "상주 3종 실시간 최상 즉각 응답"),
    ("문서 처리 용량 (컨텍스트)", "16K (긴 문서는 자동 분할 처리)", "32K (긴 스캔 리포트 통째 처리)", "32K ~ 64K (대형 감사 문서 원스톱)"),
    ("소프트웨어 기능 차이", "없음 (전 기능 100% 동일)", "없음 (전 기능 100% 동일)", "없음 (전 기능 100% 동일)"),
    ("데이터 외부 유출 여부", "0% (완전 온프레미스)", "0% (완전 온프레미스)", "0% (완전 온프레미스)"),
]

for row_idx, row_data in enumerate(rows_ws1, start=5):
    for col_idx, val in enumerate(row_data, start=1):
        cell = ws1.cell(row=row_idx, column=col_idx, value=val)
        cell.font = font_bold if col_idx == 1 else font_regular
        cell.alignment = align_center if col_idx in [1, 3] else align_left
        cell.border = thin_border
        if row_idx % 2 == 1: cell.fill = fill_zebra

ws1.column_dimensions['A'].width = 25
ws1.column_dimensions['B'].width = 35
ws1.column_dimensions['C'].width = 38
ws1.column_dimensions['D'].width = 38
ws1.row_dimensions[4].height = 26
for r in range(5, 15): ws1.row_dimensions[r].height = 38

# ----------------------------------------------------
# Sheet 2: 2. GraphRAG 지식 솔루션
# ----------------------------------------------------
ws_g = wb.create_sheet(title="2. GraphRAG 지식 솔루션")
ws_g.views.sheetView[0].showGridLines = True

ws_g['A1'] = "🌐 GraphRAG B2B 지식 패키지 솔루션 가이드"
ws_g['A1'].font = font_title

ws_g['A3'] = "■ 핵심 가치: bge-m3(벡터 DB) + 온톨로지(지식 그래프) 결합 패키지 판매"
ws_g['A3'].font = font_section

headers_g1 = ["구성 요소", "기술 방식", "기능 및 제품 가치 효과"]
for col_idx, text in enumerate(headers_g1, start=1):
    cell = ws_g.cell(row=4, column=col_idx, value=text)
    cell.font = font_header
    cell.fill = fill_graph_header
    cell.alignment = align_center

rows_g1 = [
    ("bge-m3 벡터 데이터", "텍스트 의미 검색 (Semantic Search)", "문서 및 텍스트의 키워드·의미적 유사도 파악"),
    ("온톨로지 지식 그래프", "복잡한 관계 추론 (Knowledge Graph)", "보안 표준, 자산, 규정 간의 복잡한 인과·교차 연관 관계 파악"),
    ("자산화 GraphRAG 패키지", "벡터 + 지식 그래프 융합 패키지", "LLM 환각(Hallucination) 없이 즉시 정확한 전문 AI 서비스 구축 가능")
]

for row_idx, row_data in enumerate(rows_g1, start=5):
    for col_idx, val in enumerate(row_data, start=1):
        cell = ws_g.cell(row=row_idx, column=col_idx, value=val)
        cell.font = font_bold if col_idx == 1 else font_regular
        cell.alignment = align_center if col_idx == 1 else align_left
        cell.border = thin_border
        if row_idx % 2 == 1: cell.fill = fill_zebra

ws_g['A10'] = "■ B2B 세일즈 포인트 및 타깃 고객"
ws_g['A10'].font = font_section

headers_g2 = ["구분", "내용"]
for col_idx, text in enumerate(headers_g2, start=1):
    cell = ws_g.cell(row=11, column=col_idx, value=text)
    cell.font = font_header
    cell.fill = fill_graph_header
    cell.alignment = align_center

rows_g2 = [
    ("판매 대상 (Target B2B)", "B2B 전문 기업 (금융사, 병원, 제조 대기업, 법무법인, 공공기관 등)"),
    ("핵심 세일즈 멘트", "\"우리 솔루션을 도입하면, 텍스트 의미 검색(bge-m3)과 복잡한 관계 추론(온톨로지)이 동시에 가능해져 LLM 환각(Hallucination) 없이 즉시 정확한 전문 AI 서비스를 구축할 수 있습니다.\""),
    ("지식 자산화 흐름", "기업 내부 데이터/노하우 ➔ (자산화) ➔ bge-m3 벡터 + 온톨로지 지식 그래프 ➔ 자산화된 GraphRAG 패키지 ➔ 타 기업 LLM/RAG 구축용 판매")
]

for row_idx, row_data in enumerate(rows_g2, start=12):
    for col_idx, val in enumerate(row_data, start=1):
        cell = ws_g.cell(row=row_idx, column=col_idx, value=val)
        cell.font = font_bold if col_idx == 1 else font_sales
        cell.alignment = align_center if col_idx == 1 else align_left
        cell.border = thin_border
        if col_idx == 2 and row_idx == 13: cell.fill = fill_callout

ws_g.column_dimensions['A'].width = 25
ws_g.column_dimensions['B'].width = 35
ws_g.column_dimensions['C'].width = 65

for r in range(4, 8): ws_g.row_dimensions[r].height = 26
ws_g.row_dimensions[12].height = 26
ws_g.row_dimensions[13].height = 50
ws_g.row_dimensions[14].height = 40

# ----------------------------------------------------
# Sheet 3: 3. VRAM 측정 & 고객사 미설치 PC 사전 실측 가이드
# ----------------------------------------------------
ws2 = wb.create_sheet(title="3. VRAM 및 미설치PC 사전실측")
ws2.views.sheetView[0].showGridLines = True

ws2['A1'] = "⚙️ VRAM 티어 구동 가이드 & 고객사 모델 미설치 PC 사전 실측 가이드"
ws2['A1'].font = font_title

ws2['A3'] = "■ 💡 고객사 PC에 모델 파일이 없을 때 사전 VRAM 실측 방법 (3가지)"
ws2['A3'].font = font_section

headers_ws2_no_model = ["실측 방식", "실행 방법 / 터미널 명령어", "특징 및 비고"]
for col_idx, text in enumerate(headers_ws2_no_model, start=1):
    cell = ws2.cell(row=4, column=col_idx, value=text)
    cell.font = font_header
    cell.fill = fill_bench_header
    cell.alignment = align_center

rows_ws2_no_model = [
    ("방법 1: 더미 VRAM 할당 모드 (추천)", "node tools/model-benchmark.mjs --dry-run --vram 16384", "모델 파일 없이 CUDA 런타임 & 가상 VRAM 메모리 할당 및 버퍼 1초 내 측정"),
    ("방법 2: nvidia-smi 하드웨어 실측", "nvidia-smi --query-gpu=name,memory.total,memory.free --format=csv", "고객사 PC의 그래픽카드 VRAM 총용량 및 가용 메모리 3초 내 실측"),
    ("방법 3: 초경량 100MB 테스트 모델", "server/models/test-dummy/ 100MB 파일 배치 후 측정", "초경량 더미 파일로 런타임 오버헤드 및 엔진 로드 속도 사전 실측")
]

for row_idx, row_data in enumerate(rows_ws2_no_model, start=5):
    for col_idx, val in enumerate(row_data, start=1):
        cell = ws2.cell(row=row_idx, column=col_idx, value=val)
        cell.font = font_code if col_idx == 2 else (font_bold if col_idx == 1 else font_regular)
        cell.alignment = align_center if col_idx == 1 else align_left
        cell.border = thin_border
        if row_idx % 2 == 1: cell.fill = fill_zebra

ws2['A10'] = "■ 2개 채팅 LLM 동시 구동 실태 분석 (RTX 3090 24GB 실측)"
ws2['A10'].font = font_section

headers_ws2_0 = ["구분", "모델명 / 설정", "점유 VRAM", "역할 및 필요성"]
for col_idx, text in enumerate(headers_ws2_0, start=1):
    cell = ws2.cell(row=11, column=col_idx, value=text)
    cell.font = font_header
    cell.fill = fill_main_header
    cell.alignment = align_center

rows_ws2_0 = [
    ("채팅 프로세스 ①", "gijo-main-orchestrator (7.6B Q5)", "~ 5.4 GB", "오케스트레이터 전용 (도구 라우팅/JSON 판단)"),
    ("채팅 프로세스 ②", "merged-lily (7B Q5) — 2026-07 실측 구성", "~ 4.6 GB", "5개 전문 에이전트(scan/analysis/report 등) 공용. ⚠ 합성으로 만든 옛 모델이며 합성 기능은 2026-09-07에 없앴습니다. 현재 기본 채팅 모델은 qwen3-14b."),
    ("RAG 임베딩", "bge-m3 (ctx 8192)", "1.1 ~ 1.5 GB", "RAG 검색 필수 상주 (스왑 대상 아님)"),
    ("실측 총 점유", "32K 컨텍스트 기준", "약 16.0 GB (33% 여유)", "2개 동시 구동 시 모델 전환 대기시간 0초 제공")
]

for row_idx, row_data in enumerate(rows_ws2_0, start=12):
    for col_idx, val in enumerate(row_data, start=1):
        cell = ws2.cell(row=row_idx, column=col_idx, value=val)
        cell.font = font_bold if col_idx == 1 else font_regular
        cell.alignment = align_center if col_idx in [1, 3] else align_left
        cell.border = thin_border
        if row_idx % 2 == 1: cell.fill = fill_zebra

ws2['A18'] = "■ 티어별 환경변수 (설치 시 설정 가이드)"
ws2['A18'].font = font_section

headers_ws2_2 = ["티어", "환경변수 키 (Environment Variable)", "권장 설정값", "설명"]
for col_idx, text in enumerate(headers_ws2_2, start=1):
    cell = ws2.cell(row=19, column=col_idx, value=text)
    cell.font = font_header
    cell.fill = fill_main_header
    cell.alignment = align_center

rows_ws2_2 = [
    ("AS Lite (12GB)", "GIJO_MAX_LOADED_MODELS\nGIJO_LOCAL_LLM_CTX_SIZE\nGIJO_MODEL_VRAM_OVERHEAD_MB", "1\n16384 (또는 8192)\n3500", "단일 LLM 모드 (LRU 스왑 구동)\n16K 컨텍스트로 12GB 안전 구동"),
    ("AS Standard (24GB)", "GIJO_MAX_LOADED_MODELS\nGIJO_LOCAL_LLM_CTX_SIZE", "2\n32768", "2개 상주 (지휘+전문가) 현행 기본값\n실측 16GB 사용 → 8GB 여유 버퍼"),
    ("AS Pro (30GB+)", "GIJO_MAX_LOADED_MODELS\nGIJO_LOCAL_LLM_CTX_SIZE", "3\n32768 (일부 64K)", "3개 상주 (지휘+전문가+특화)\n14B/20B 모델 탑재 지원")
]

for row_idx, row_data in enumerate(rows_ws2_2, start=20):
    for col_idx, val in enumerate(row_data, start=1):
        cell = ws2.cell(row=row_idx, column=col_idx, value=val)
        cell.font = font_code if col_idx in [2, 3] else (font_bold if col_idx == 1 else font_regular)
        cell.alignment = align_center if col_idx == 1 else align_left
        cell.border = thin_border
        if row_idx % 2 == 1: cell.fill = fill_zebra

ws2.column_dimensions['A'].width = 24
ws2.column_dimensions['B'].width = 45
ws2.column_dimensions['C'].width = 24
ws2.column_dimensions['D'].width = 45

for r in range(4, 8): ws2.row_dimensions[r].height = 28
for r in range(11, 16): ws2.row_dimensions[r].height = 24
for r in range(19, 23): ws2.row_dimensions[r].height = 50

# ----------------------------------------------------
# Sheet 4: 4. 상업 번들 LLM 후보
# ----------------------------------------------------
ws3 = wb.create_sheet(title="4. 상업 번들 LLM 후보")
ws3.views.sheetView[0].showGridLines = True

ws3['A1'] = "🤖 GIJO AS 상업 번들 LLM 모델 후보 및 라이선스 가이드라인"
ws3['A1'].font = font_title

ws3['A3'] = "■ 1군: 무조건 안전 (Apache-2.0 / MIT 상업 동봉 가능)"
ws3['A3'].font = font_section

headers_ws3_1 = ["모델명 (제조사)", "크기", "라이선스", "주요 강점 및 용도", "번들 판정"]
for col_idx, text in enumerate(headers_ws3_1, start=1):
    cell = ws3.cell(row=4, column=col_idx, value=text)
    cell.font = font_header
    cell.fill = fill_main_header
    cell.alignment = align_center

rows_ws3_1 = [
    ("Qwen3-8B / 3.5 (Alibaba)", "8B", "Apache-2.0", "한국어 상위권, JSON 도구호출 우수 (지휘/라우팅 모델 적임)", "✅ 1군 안전 (기본 지휘)"),
    ("Kanana-1.5-8B (카카오)", "8B", "Apache-2.0", "국산·한국어 특화, 영업 스토리 우수 (한국어 전문가 슬롯 적임)", "✅ 1군 안전 (기본 전문가)"),
    ("Upstage SOLAR (업스테이지)", "10.7B", "Apache-2.0", "국산, 한국어 성능 뛰어남 (Kanana 대체 슬롯 가능)", "✅ 1군 안전"),
    ("Phi-4 / Phi-4-mini (MS)", "14B/3.8B", "MIT", "14B급 강력한 추론력 (Pro 티어 전문가 승격 후보)", "✅ 1군 안전"),
    ("gpt-oss-20b (OpenAI)", "20B MoE", "Apache-2.0", "추론 및 도구호출 강력 (~16GB로 Pro 티어 탑재 가능)", "✅ 1군 안전"),
    ("DeepSeek-R1-Distill-Qwen", "7-8B", "MIT", "사고과정/추론 특화 (분석 에이전트 전담 후보)", "✅ 1군 안전"),
    ("Granite 3.x-8B (IBM)", "8B", "Apache-2.0", "엔터프라이즈 안전성 검증 문서화 우수", "✅ 1군 안전"),
]

for row_idx, row_data in enumerate(rows_ws3_1, start=5):
    for col_idx, val in enumerate(row_data, start=1):
        cell = ws3.cell(row=row_idx, column=col_idx, value=val)
        cell.font = font_bold if col_idx == 1 else font_regular
        cell.alignment = align_center if col_idx in [2, 3, 5] else align_left
        cell.border = thin_border
        if col_idx == 5: cell.fill = fill_safe

ws3['A14'] = "■ 조건부 및 번들 금지 모델 (비상업 / 제약 사항)"
ws3['A14'].font = font_section

headers_ws3_2 = ["모델명", "라이선스 및 조건", "번들 판정 및 가이드라인"]
for col_idx, text in enumerate(headers_ws3_2, start=1):
    cell = ws3.cell(row=15, column=col_idx, value=text)
    cell.font = font_header
    cell.fill = fill_main_header
    cell.alignment = align_center

rows_ws3_2 = [
    ("Llama 3.1 / 3.2-8B (Meta)", "커뮤니티 라이선스 (7억 MAU 미만 OK + Built with Llama 표기)", "⚠️ 조건부 번들 가능 (표기 의무 준수 필요)"),
    ("EXAONE 3.5 / Deep (LG)", "연구목적 한정 라이선스 (NC)", "❌ 번들 절대 금지 (상업 번들 불가 / 고객 BYOM 안내만)"),
    ("Qwen2.5-3B (Alibaba)", "Qwen Research License (비상업)", "❌ 번들 금지 (제품 게이트 restricted 차단)"),
    ("Ministral-8B (Mistral)", "Mistral Research License (비상업)", "❌ 번들 금지 (상업용 사용 불합격)"),
    ("Kanana 나노 2.1B (CC-BY-NC)", "연구용 CC-BY-NC 라이선스", "❌ 번들 금지 (Kanana 1.5-8B 버전만 번들 사용)"),
    ("Gukbap-Qwen2.5-7B (국밥)", "CC-BY-NC-4.0 (비상업)", "❌ 번들 금지 (비상업 라이선스)")
]

for row_idx, row_data in enumerate(rows_ws3_2, start=16):
    for col_idx, val in enumerate(row_data, start=1):
        cell = ws3.cell(row=row_idx, column=col_idx, value=val)
        cell.font = font_bold if col_idx == 1 else font_regular
        cell.alignment = align_center if col_idx == 3 else align_left
        cell.border = thin_border
        if "❌" in row_data[2]: cell.fill = fill_ban
        elif "⚠️" in row_data[2]: cell.fill = fill_warn

ws3.column_dimensions['A'].width = 30
ws3.column_dimensions['B'].width = 38
ws3.column_dimensions['C'].width = 45
ws3.column_dimensions['D'].width = 45
ws3.column_dimensions['E'].width = 28

for r in range(4, 12): ws3.row_dimensions[r].height = 24
for r in range(15, 22): ws3.row_dimensions[r].height = 24

# ----------------------------------------------------
# Sheet 5: 5. 모델 학습(파인튜닝) 전략 — 합성은 없앤 기능
# ----------------------------------------------------
ws4 = wb.create_sheet(title="5. 모델 학습(파인튜닝) 전략")
ws4.views.sheetView[0].showGridLines = True

ws4['A1'] = "🧪 gijo 모델 학습(QLoRA 파인튜닝) — 합성(SLERP Merge)은 제공하지 않습니다"
ws4['A1'].font = font_title

ws4['A3'] = "■ 합성(SLERP Merge)은 없앤 기능입니다 — 지금 제공하는 것은 파인튜닝(QLoRA)뿐입니다"
ws4['A3'].font = font_section

headers_ws4_1 = ["구분 항목", "합성(SLERP Merge) — ❌ 없앤 기능", "Finetune (QLoRA 파인튜닝)"]
for col_idx, text in enumerate(headers_ws4_1, start=1):
    cell = ws4.cell(row=4, column=col_idx, value=text)
    cell.font = font_header
    cell.fill = fill_main_header
    cell.alignment = align_center

rows_ws4_1 = [
    ("개념 및 작동 방식", "같은 아키텍처 모델 둘의 가중치를 섞는 방식. 제품에서는 없앴습니다(2026-09-07).", "gijo 베이스 모델에 도메인 데이터셋을 각인"),
    ("핵심 제약 조건", "— (없앤 기능이라 제약을 따질 일이 없습니다)", "아키텍처 무관, gijo 베이스 모델에 자유 학습 가능"),
    ("주요 강점", "— (없앤 기능입니다. 한국어·보안 지식은 번들 모델 선택과 지식 반입(RAG)으로 맞춥니다.)", "문체·판단·구조화 출력(JSON) 교정, 사내 사례 체화"),
    ("구동 비용 및 속도", "— (없앤 기능입니다.)", "GPU 학습 시간 및 데이터셋 구성 필요"),
    ("제품 내 제공 기능", "❌ 없앤 기능 — 화면·엔진·창구를 2026-09-07에 통째로 내렸습니다. 제품에 합성 화면은 없습니다.", "AI 지식·모델 학습 / 헤르메스 학습 루프"),
    ("실증 및 검증", "2026-07에 그렇게 만든 모델 파일이 있었고 라이선스도 확인했지만, 합성 기능 자체를 없앴습니다 — 새로 만들 수는 없습니다.", "Hermes 학습 루프 실 GPU 구동 실증 완료")
]

for row_idx, row_data in enumerate(rows_ws4_1, start=5):
    for col_idx, val in enumerate(row_data, start=1):
        cell = ws4.cell(row=row_idx, column=col_idx, value=val)
        cell.font = font_bold if col_idx == 1 else font_regular
        cell.alignment = align_center if col_idx == 1 else align_left
        cell.border = thin_border
        if row_idx % 2 == 1: cell.fill = fill_zebra

ws4.column_dimensions['A'].width = 25
ws4.column_dimensions['B'].width = 45
ws4.column_dimensions['C'].width = 45

for r in range(4, 11): ws4.row_dimensions[r].height = 28

# ----------------------------------------------------
# Sheet 6: 6. 구매자 추천 & FAQ
# ----------------------------------------------------
ws5 = wb.create_sheet(title="6. 구매자 추천 & FAQ")
ws5.views.sheetView[0].showGridLines = True

ws5['A1'] = "🎯 우리 회사 상황별 추천 가이드 및 자주 묻는 질문(FAQ)"
ws5['A1'].font = font_title

ws5['A3'] = "■ 구매자 상황별 추천 카드"
ws5['A3'].font = font_section

headers_ws5_1 = ["현재 우리 회사의 보안 상황", "추천 제품", "도입 기대 효과 및 선택 이유"]
for col_idx, text in enumerate(headers_ws5_1, start=1):
    cell = ws5.cell(row=4, column=col_idx, value=text)
    cell.font = font_header
    cell.fill = fill_main_header
    cell.alignment = align_center

rows_ws5_1 = [
    ("• 보안 담당자가 1명(IT 겸직 포함)이라 업무 부담이 큰 경우\n• 기존 보유 PC/워크스테이션에 미들급 GPU만 추가하여 시작하고 싶은 경우\n• AI 보안 도입을 낮은 비용으로 파일럿 검증하고 싶은 경우",
     "AS Lite (12GB)",
     "• 도입 비용 최소화 (미들급 GPU 1장으로 부담 없이 시작)\n• 1인 담당자의 반복 업무(일일 브리핑, SLA 알림, 정기점검)를 AI가 대신 수행\n• 소음 및 전력 부담 최소화하며 주요 보안 기능 100% 이용 가능"),
    
    ("• 2~3명의 보안 전담팀이 운영되고 있는 경우\n• 취약점 점검, 위협 분석, 보고서 생성을 동시에 수행해야 하는 경우\n• 챗봇 질의 시 기다림 없는 빠른 답변을 원하는 경우",
     "AS Standard (24GB)\n[가장 인기있는 선택]",
     "• 지휘 AI(Qwen3)와 보안전문가 AI(Kanana-1.5)가 동시 상주하여 즉각 고품질 답변 제공\n• 32K 컨텍스트 지원으로 긴 보안 리포트와 매뉴얼도 한 번에 처리\n• 실제 현 운영 환경에서 실측 및 안정성 검증이 완료된 최적의 제품"),
    
    ("• 3명 이상의 보안팀 또는 전문 보안관제(SOC)를 운영하는 경우\n• 다수 담당자가 동시에 챗봇 지시, 리포트 생성, 점검을 수행하는 경우\n• 수천 건 규모의 대용량 자산 스캔 리포트를 정기 반입하는 경우",
     "AS Pro (30GB+)",
     "• 3개 AI 모델(지휘+전문가+특화) 분업 체계로 동시 접속 시에도 대기 시간 0초\n• 대형 14B급/20B급 전문가 모델 구동으로 더욱 심도 있는 분석 품질 제공\n• 향후 추가 AI 모델 확장 및 대형 감사 문서 통짜 처리 가능")
]

for row_idx, row_data in enumerate(rows_ws5_1, start=5):
    for col_idx, val in enumerate(row_data, start=1):
        cell = ws5.cell(row=row_idx, column=col_idx, value=val)
        cell.font = font_bold if col_idx == 2 else font_regular
        cell.alignment = align_center if col_idx == 2 else align_left
        cell.border = thin_border
        if col_idx == 2: cell.fill = fill_highlight
        elif row_idx % 2 == 1: cell.fill = fill_zebra

ws5['A10'] = "■ 자주 묻는 질문 (FAQ)"
ws5['A10'].font = font_section

headers_ws5_2 = ["자주 묻는 질문 (Question)", "구매자 안내 답변 (Answer)"]
for col_idx, text in enumerate(headers_ws5_2, start=1):
    cell = ws5.cell(row=11, column=col_idx, value=text)
    cell.font = font_header
    cell.fill = fill_main_header
    cell.alignment = align_center

rows_ws5_2 = [
    ("Q. Lite 제품을 구매하면 보안 기능이 일부 제외되나요?",
     "A. 아니오, 전혀 그렇지 않습니다. 취약점 스캔, 조치 배정, 리포트 생성, 챗봇 등 모든 소프트웨어 기능은 100% 동일하게 제공되며, 차이는 AI 모델 수(응답 속도 및 동시 처리 능력)뿐입니다."),
    
    ("Q. 기존에 회사에서 사용 중인 PC나 서버를 활용할 수 있나요?",
     "A. 네, 가능합니다. 고가의 신규 서버를 구매하지 않아도 보유 중인 GPU 사양(12GB / 24GB / 30GB+)에 맞춰 즉시 설치하여 운용하실 수 있습니다."),
    
    ("Q. 고객 직접 반입(BYOM) 시 라이선스 책임은 어떻게 되나요?",
     "A. 모델 반입은 자유이나 반입 모델의 라이선스 준수 책임은 고객에게 이전됩니다. 제품 내 라이선스 게이트(modellicense.ts)가 비상업 모델 반입 시 자동 경고를 표시합니다."),
    
    ("Q. Standard 구성이 실제로 검증된 모델인가요?",
     "A. 네, 현재 실제 운영 환경이 Standard 구성(RTX 3090 24GB)이며, Qwen3-8B와 Kanana-1.5-8B 2상주 모델로 빠른 응답 속도가 사전 검증된 추천 구성입니다.")
]

for row_idx, row_data in enumerate(rows_ws5_2, start=12):
    for col_idx, val in enumerate(row_data, start=1):
        cell = ws5.cell(row=row_idx, column=col_idx, value=val)
        cell.font = font_bold if col_idx == 1 else font_regular
        cell.alignment = align_left
        cell.border = thin_border
        if row_idx % 2 == 1: cell.fill = fill_zebra

ws5.column_dimensions['A'].width = 45
ws5.column_dimensions['B'].width = 28
ws5.column_dimensions['C'].width = 50

for r in range(5, 8): ws5.row_dimensions[r].height = 65
for r in range(12, 16): ws5.row_dimensions[r].height = 35

# Save output to paths
out_path_1 = r"D:\Connect AI\GIJO_AS_제품_라인업_구매자_가이드.xlsx"
out_path_2 = r"C:\Users\user\.gemini\antigravity-ide\scratch\GIJO_AS_제품_라인업_구매자_가이드.xlsx"

os.makedirs(os.path.dirname(out_path_1), exist_ok=True)
os.makedirs(os.path.dirname(out_path_2), exist_ok=True)

wb.save(out_path_1)
wb.save(out_path_2)

print(f"Saved Excel files successfully with Customer PC No-Model Benchmark guide sheet to:\n- {out_path_1}\n- {out_path_2}")
