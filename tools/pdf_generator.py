"""
PDFGeneratorTool - Generate PDF guides using Playwright and Jinja2.

Creates comprehensive PDF guides with:
- Cover page with session summary and weather
- Route map image
- Point-by-point itinerary
- Bangumi information sections
- Bilingual (CN/JP) content
"""

from pathlib import Path
from typing import Optional
from jinja2 import Environment, FileSystemLoader, select_autoescape
from playwright.async_api import async_playwright
from domain.entities import PilgrimageSession
from tools.base import BaseTool


class PDFGeneratorTool(BaseTool):
    """
    Generate PDF pilgrimage guides with complete trip information.

    Uses Jinja2 for HTML templating and Playwright for PDF conversion.
    """

    def __init__(self, output_dir: Optional[str] = None):
        """
        Initialize the PDFGeneratorTool.

        Args:
            output_dir: Directory to save PDF files. Defaults to "output/pdfs"
        """
        super().__init__(output_dir=output_dir or "output/pdfs")

        # Setup Jinja2 environment
        template_dir = Path(__file__).parent.parent / "templates"
        self.jinja_env = Environment(
            loader=FileSystemLoader(str(template_dir)),
            autoescape=select_autoescape(['html', 'xml'])
        )

        self.logger.info("PDFGeneratorTool initialized", template_dir=str(template_dir))

    async def generate(self, session: PilgrimageSession, map_image_path: Optional[str] = None) -> str:
        """
        Generate a PDF guide from a PilgrimageSession.

        Args:
            session: Complete PilgrimageSession with route and data
            map_image_path: Optional path to map image to embed

        Returns:
            Path to the generated PDF file

        Raises:
            ValueError: If session data is incomplete
        """
        # Validate input
        if not self.validate_session(session):
            raise ValueError("Session must have complete route data")

        self.logger.info(
            "Generating PDF for session",
            session_id=session.session_id,
            points_count=len(session.route.segments)
        )

        # Render HTML
        html_content = await self._render_html(session, map_image_path)

        # Convert HTML to PDF
        output_path = await self._html_to_pdf(html_content, session.session_id)

        self.logger.info(
            "PDF generated successfully",
            session_id=session.session_id,
            output_path=str(output_path)
        )

        return str(output_path)

    async def _render_html(
        self,
        session: PilgrimageSession,
        map_image_path: Optional[str] = None
    ) -> str:
        """
        Render complete HTML document from templates.

        Args:
            session: PilgrimageSession data
            map_image_path: Optional path to map image

        Returns:
            Complete HTML string
        """
        # Load CSS
        css_content = await self._load_css()

        # Render individual sections
        cover_html = await self._render_template("pdf_cover.html", {"session": session})
        itinerary_html = await self._render_template("pdf_itinerary.html", {"session": session})
        bangumi_html = await self._render_template("pdf_bangumi.html", {"session": session})

        # Render main template
        main_html = await self._render_template(
            "pdf_main.html",
            {
                "session": session,
                "css_content": css_content,
                "cover_html": cover_html,
                "itinerary_html": itinerary_html,
                "bangumi_html": bangumi_html,
                "map_image_path": map_image_path
            }
        )

        return main_html

    async def _render_template(self, template_name: str, context: dict) -> str:
        """
        Render a Jinja2 template with context.

        Args:
            template_name: Name of the template file
            context: Template context dictionary

        Returns:
            Rendered HTML string
        """
        template = self.jinja_env.get_template(template_name)
        return template.render(**context)

    async def _load_css(self) -> str:
        """Load CSS file content."""
        css_path = Path(__file__).parent.parent / "templates" / "assets" / "styles.css"

        if css_path.exists():
            return css_path.read_text(encoding="utf-8")
        else:
            self.logger.warning("CSS file not found", path=str(css_path))
            return ""

    async def _html_to_pdf(self, html_content: str, session_id: str) -> Path:
        """
        Convert HTML to PDF using Playwright.

        Args:
            html_content: HTML string to convert
            session_id: Session ID for filename

        Returns:
            Path to generated PDF file
        """
        filename = f"{session_id}.pdf"
        output_path = self.get_output_path(filename)

        async with async_playwright() as p:
            browser = None
            try:
                # Launch browser
                browser = await p.chromium.launch(headless=True)
                context = await browser.new_context()
                page = await context.new_page()

                # Set content
                await page.set_content(html_content, wait_until="networkidle")

                # Generate PDF
                await page.pdf(
                    path=str(output_path),
                    format="A4",
                    print_background=True,
                    margin={
                        "top": "10mm",
                        "right": "10mm",
                        "bottom": "10mm",
                        "left": "10mm"
                    }
                )

                self.logger.info(
                    "PDF conversion successful",
                    output_path=str(output_path)
                )

            finally:
                # Always close browser
                if browser:
                    await browser.close()

        return output_path
