from a_download import download_budget_docs
from b_parse_downloaded import parse_budget_docs

if __name__ == "__main__":
    for year in range(2020, 2028):
        session = year - 1946
        symbol = f"A/{session}/6"
        # a
        download_budget_docs(symbol, year)
        # b
        # parse_budget_docs(year)
