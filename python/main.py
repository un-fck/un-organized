from a_download import download_budget_docs
from b_extract_organigrams import extract_all

if __name__ == "__main__":
    # a -- download the PPB documents
    for year in range(2020, 2028):
        session = year - 1946
        symbol = f"A/{session}/6"
        download_budget_docs(symbol, year)
    # b -- extract organigram data from the downloaded documents
    extract_all()
